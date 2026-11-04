import { beforeEach, describe, expect, it } from 'vitest';
import { SoleForgeDB, getDB, setDB } from '../src/db/db';
import {
  deleteDesign,
  duplicateDesign,
  listDesigns,
  moveDesign,
  saveDesign,
  putBlob,
  getBlob,
  updateDesignMeta,
  reorderDesigns,
} from '../src/db/repo';
import { exportAll, importAll, migrate } from '../src/db/backup';
import { createDesign } from '../src/models/design';

let n = 0;
async function fresh() {
  const db = new SoleForgeDB('test-' + n++);
  setDB(db);
  await db.open();
  return db;
}

describe('IndexedDB (Dexie) 保存', () => {
  beforeEach(async () => {
    await fresh();
  });

  it('保存・並べ替え・複製・削除が DB に残る（再起動 = 新しい接続でも残る）', async () => {
    const a = createDesign('A', 0);
    const b = createDesign('B', 1);
    const c = createDesign('C', 2);
    for (const d of [a, b, c]) await saveDesign(d);
    await moveDesign(c.id, -1);
    expect((await listDesigns()).map((d) => d.name)).toEqual(['A', 'C', 'B']);
    await reorderDesigns([b.id, a.id, c.id]);
    expect((await listDesigns()).map((d) => d.name)).toEqual(['B', 'A', 'C']);
    const copy = await duplicateDesign(a.id);
    expect((await listDesigns()).map((d) => d.name)).toEqual(['B', 'A', 'A のコピー', 'C']);
    await deleteDesign(b.id);
    await updateDesignMeta(copy!.id, { name: 'A2', favorite: true });

    // 「再起動」: 同じ名前の DB を新しく開き直す
    const name = getDB().name;
    getDB().close();
    const again = new SoleForgeDB(name);
    setDB(again);
    await again.open();
    const list = await listDesigns();
    expect(list.map((d) => d.name)).toEqual(['A', 'A2', 'C']);
    expect(list[1].favorite).toBe(true);
  });

  it('JSON 書き出し → 別端末（空の DB）へ読み込みで復元できる', async () => {
    const a = createDesign('Alpha', 0);
    a.parts.upper = { color: '#FF0000', material: 'suede', pattern: { type: 'camo', colors: ['#111111', '#222222'] } };
    a.decals.push({
      id: 'k',
      kind: 'image',
      src: 'img:1',
      part: 'upper',
      position: [0, 1, 0.5],
      normal: [0, 0, 1],
      scale: 0.5,
      rotation: 10,
      flip: true,
      z: 0,
    });
    await saveDesign(a);
    await putBlob('img:1', new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }));
    await putBlob('thumb:' + a.id, new Blob([new Uint8Array([9, 9])], { type: 'image/png' }));
    const file = JSON.parse(JSON.stringify(await exportAll()));
    expect(file.blobs['img:1']).toMatch(/^data:image\/png;base64,/);

    await fresh(); // 別端末
    const res = await importAll(file);
    expect(res).toEqual({ added: 1, replaced: 0 });
    const [restored] = await listDesigns();
    expect(restored.name).toBe('Alpha');
    expect(restored.parts.upper).toEqual(a.parts.upper);
    expect(restored.decals[0]).toMatchObject({ src: 'img:1', rotation: 10, flip: true });
    const blob = await getBlob('img:1');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]));
    // 同じファイルをもう一度読むと上書き
    expect(await importAll(file)).toEqual({ added: 0, replaced: 1 });
  });

  it('不正な JSON / 未来の schemaVersion は拒否する', () => {
    expect(() => migrate({})).toThrow();
    expect(() => migrate({ app: 'sole-forge', schemaVersion: 99, designs: [] })).toThrow(/新しい版/);
    const ok = migrate({ app: 'sole-forge', schemaVersion: 1, designs: [{ name: 'x', parts: { upper: { color: 'bad' } } }] });
    expect(ok.designs[0].parts.upper.color).toBe('#F2F2EE');
    expect(Object.keys(ok.designs[0].parts)).toHaveLength(10);
  });
});
