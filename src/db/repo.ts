import { getDB } from './db';
import type { SneakerDesign } from '../models/types';
import { cloneDesign, uid } from '../models/design';

export const thumbKey = (designId: string) => `thumb:${designId}`;

export async function listDesigns(): Promise<SneakerDesign[]> {
  return getDB().designs.orderBy('shelfOrder').toArray();
}

export async function getDesign(id: string): Promise<SneakerDesign | undefined> {
  return getDB().designs.get(id);
}

export async function saveDesign(d: SneakerDesign): Promise<void> {
  await getDB().designs.put(cloneDesign(d));
}

export async function nextShelfOrder(): Promise<number> {
  const last = await getDB().designs.orderBy('shelfOrder').last();
  return last ? last.shelfOrder + 1 : 0;
}

export async function updateDesignMeta(id: string, patch: Partial<Pick<SneakerDesign, 'name' | 'favorite' | 'shelfOrder'>>) {
  await getDB().designs.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function duplicateDesign(id: string): Promise<SneakerDesign | undefined> {
  const db = getDB();
  return db.transaction('rw', db.designs, db.blobs, async () => {
    const src = await db.designs.get(id);
    if (!src) return undefined;
    const all = await db.designs.orderBy('shelfOrder').toArray();
    // 元の直後に挿入し、後ろを 1 つずつずらす
    const now = new Date().toISOString();
    const copy: SneakerDesign = {
      ...cloneDesign(src),
      id: uid('d_'),
      name: `${src.name} のコピー`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      shelfOrder: src.shelfOrder + 1,
      decals: src.decals.map((d) => ({ ...d, id: uid('dc_') })),
    };
    for (const d of all) {
      if (d.shelfOrder > src.shelfOrder) await db.designs.update(d.id, { shelfOrder: d.shelfOrder + 1 });
    }
    const thumb = await db.blobs.get(thumbKey(src.id));
    if (thumb) {
      await db.blobs.put({ ...thumb, key: thumbKey(copy.id) });
      copy.thumbnail = thumbKey(copy.id);
    } else {
      delete copy.thumbnail;
    }
    await db.designs.put(copy);
    return copy;
  });
}

export async function deleteDesign(id: string): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.designs, db.blobs, async () => {
    await db.designs.delete(id);
    await db.blobs.delete(thumbKey(id));
  });
  await gcBlobs();
}

/** 並び順を ids の順に振り直す */
export async function reorderDesigns(ids: string[]): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.designs, async () => {
    for (let i = 0; i < ids.length; i++) await db.designs.update(ids[i], { shelfOrder: i });
  });
}

/** 指定作品を前(-1)/後(+1)へ動かす */
export async function moveDesign(id: string, delta: -1 | 1): Promise<void> {
  const list = await listDesigns();
  const i = list.findIndex((d) => d.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  const ids = list.map((d) => d.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderDesigns(ids);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await getDB().blobs.put({ key, blob, type: blob.type, createdAt: new Date().toISOString() });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await getDB().blobs.get(key))?.blob;
}

/** どの作品からも参照されていない画像 Blob を消す */
export async function gcBlobs(): Promise<number> {
  const db = getDB();
  const designs = await db.designs.toArray();
  const used = new Set<string>();
  for (const d of designs) {
    used.add(thumbKey(d.id));
    for (const dc of d.decals) if (dc.kind === 'image' && dc.src) used.add(dc.src);
  }
  const keys = (await db.blobs.toCollection().primaryKeys()) as string[];
  const dead = keys.filter((k) => !used.has(k) && (k.startsWith('img:') || k.startsWith('thumb:')));
  // 直近 10 分以内に読み込んだ画像は、まだ貼り付け前の可能性があるので残す
  const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const deletable: string[] = [];
  for (const k of dead) {
    const rec = await db.blobs.get(k);
    if (rec && (k.startsWith('thumb:') || rec.createdAt < recent)) deletable.push(k);
  }
  await db.blobs.bulkDelete(deletable);
  return deletable.length;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await getDB().settings.get(key);
  return r ? (r.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await getDB().settings.put({ key, value });
}

export async function clearAll(): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.designs, db.blobs, db.settings, async () => {
    await db.designs.clear();
    await db.blobs.clear();
    await db.settings.clear();
  });
}
