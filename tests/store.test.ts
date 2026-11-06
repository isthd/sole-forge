import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor, undo, redo, endBurst, HISTORY_LIMIT } from '../src/store/editorStore';
import { createDesign, mirrorDecals } from '../src/models/design';
import { randomParts } from '../src/store/random';
import { PART_IDS, MATERIAL_IDS, PATTERN_TYPES } from '../src/models/types';

const s = () => useEditor.getState();

describe('editor store (zustand + zundo)', () => {
  beforeEach(() => {
    s().loadDesign(createDesign('test'));
  });

  it('Undo/Redo が 50 手以上効く', () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(50);
    const colors: string[] = [];
    for (let i = 0; i < 60; i++) {
      const c = '#' + (0x100000 + i * 997).toString(16).slice(-6).toUpperCase();
      colors.push(c);
      endBurst(); // 別々の操作として記録
      s().setPartColor('upper', c);
    }
    expect(s().design!.parts.upper.color).toBe(colors[59]);
    expect(useEditor.temporal.getState().pastStates.length).toBe(60);
    for (let i = 0; i < 55; i++) undo();
    expect(s().design!.parts.upper.color).toBe(colors[4]);
    for (let i = 0; i < 55; i++) redo();
    expect(s().design!.parts.upper.color).toBe(colors[59]);
  });

  it('連続ドラッグ中の変更は 1 手にまとまる', () => {
    endBurst();
    for (let i = 0; i < 20; i++) s().setPartColor('toe', '#0000' + (10 + i).toString());
    expect(useEditor.temporal.getState().pastStates.length).toBe(1);
    undo();
    expect(s().design!.parts.toe.color).toBe('#F2F2EE');
  });

  it('10 パーツすべてに色・素材・柄を設定できる', () => {
    for (const p of PART_IDS) {
      s().setPartColor(p, '#123456');
      for (const m of MATERIAL_IDS) s().setMaterial(p, m);
      for (const t of PATTERN_TYPES) s().setPattern(p, t);
      const st = s().design!.parts[p];
      expect(st.color).toBe('#123456');
      expect(st.material).toBe('patent');
      expect(st.pattern?.type).toBe('dot');
      s().setPattern(p, null);
      expect(s().design!.parts[p].pattern).toBeUndefined();
    }
  });

  it('デカールの貼り付け・移動・拡大・回転・反転・重ね順', () => {
    s().startPlacing({ kind: 'text', text: 'FORGE', font: 'Oswald', color: '#FFFFFF', scale: 0.4, rotation: 0, flip: false });
    const a = s().placeDecal('upper', [0, 1, 0.5], [0, 0, 1])!;
    s().startPlacing({ kind: 'logo', src: 'logo:spark', color: '#C6FF00', scale: 0.3, rotation: 0, flip: false });
    const b = s().placeDecal('sidePanel', [-0.2, 1, 0.5], [0, 0, 1])!;
    expect(s().design!.decals).toHaveLength(2);
    s().updateDecal(a, { position: [0.3, 1.1, 0.5], scale: 0.8, rotation: 45, flip: true });
    const da = s().design!.decals.find((d) => d.id === a)!;
    expect(da).toMatchObject({ position: [0.3, 1.1, 0.5], scale: 0.8, rotation: 45, flip: true });
    expect(s().design!.decals.find((d) => d.id === b)!.z).toBeGreaterThan(da.z);
    s().moveDecalZ(a, 'top');
    const zA = s().design!.decals.find((d) => d.id === a)!.z;
    const zB = s().design!.decals.find((d) => d.id === b)!.z;
    expect(zA).toBeGreaterThan(zB);
    s().removeDecal(b);
    expect(s().design!.decals).toHaveLength(1);
  });

  it('ランダム配色は全パーツに有効な HEX を入れる', () => {
    for (let seed = 1; seed < 50; seed++) {
      const parts = randomParts(seed);
      for (const p of PART_IDS) expect(parts[p].color).toMatch(/^#[0-9A-F]{6}$/);
    }
    s().randomize(42);
    expect(s().design!.parts).toEqual(randomParts(42));
  });

  it('左右コピー: 外側のデカールを内側へミラー', () => {
    const d = createDesign();
    d.decals = [
      { id: 'x', kind: 'logo', src: 'logo:hex', part: 'upper', position: [0.2, 1, 0.5], normal: [0, 0, 1], scale: 0.3, rotation: 20, flip: false, z: 0 },
      { id: 'y', kind: 'logo', src: 'logo:hex', part: 'upper', position: [0.2, 1, -0.5], normal: [0, 0, -1], scale: 0.3, rotation: 0, flip: false, z: 1 },
    ];
    const out = mirrorDecals(d.decals, 'lateral');
    expect(out).toHaveLength(2);
    const copy = out.find((x) => x.id !== 'x')!;
    expect(copy.position).toEqual([0.2, 1, -0.5]);
    expect(copy.normal).toEqual([0, 0, -1]);
    expect(copy.rotation).toBe(-20);
    expect(copy.flip).toBe(true);
  });

  it('ベース型を切り替えられ、デカールは新しい型の表面へ載せ直され、Undo で戻る', () => {
    endBurst();
    s().startPlacing({ kind: 'logo', src: 'logo:hex', scale: 0.4, rotation: 0, flip: false });
    // ハイカットのくるぶし付近（外側）。ローカットにはこの高さの面が無い
    s().placeDecal('upper', [-0.9, 1.7, 0.42], [0, 0, 1]);
    const before = s().design!.decals[0];
    endBurst();
    s().setBaseModel('lowtop-01');
    const d = s().design!;
    expect(d.baseModel).toBe('lowtop-01');
    const after = d.decals[0];
    expect(after.id).toBe(before.id);
    expect(after.position[1]).toBeLessThan(1.3);
    expect(after.position[2]).toBeGreaterThan(0.2);
    expect(PART_IDS).toContain(after.part);
    undo();
    expect(s().design!.baseModel).toBe('hightop-01');
    expect(s().design!.decals[0].position).toEqual(before.position);
    redo();
    expect(s().design!.baseModel).toBe('lowtop-01');
  });

  it('同じ型を選んでも履歴は増えない', () => {
    const n = useEditor.temporal.getState().pastStates.length;
    s().setBaseModel('hightop-01');
    expect(useEditor.temporal.getState().pastStates.length).toBe(n);
  });
});
