import { getDB } from './db';
import { thumbKey } from './repo';
import type { Decal, PartId, PartStyle, SneakerDesign } from '../models/types';
import {
  CURRENT_SCHEMA_VERSION,
  MATERIAL_IDS,
  isBaseModelId,
  PART_IDS,
  PATTERN_DIRECTIONS,
  PATTERN_SCALE_MAX,
  PATTERN_SCALE_MIN,
  PATTERN_TYPES,
} from '../models/types';
import { DEFAULT_PARTS, HEX_RE, uid } from '../models/design';
import { normalizeShape } from '../models/shape';

/** JSON バックアップ 1 ファイル。画像は Base64 (data URL) で埋め込む。 */
export interface BackupFile {
  app: 'sole-forge';
  schemaVersion: number;
  exportedAt: string;
  designs: SneakerDesign[];
  blobs: Record<string, string>;
}

export async function blobToDataURL(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataURLToBlob(url: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('不正な data URL');
  const type = m[1] || 'application/octet-stream';
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
  const bin = atob(m[3]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

export async function exportAll(): Promise<BackupFile> {
  const db = getDB();
  const designs = await db.designs.orderBy('shelfOrder').toArray();
  const blobs: Record<string, string> = {};
  for (const d of designs) {
    const keys = [thumbKey(d.id), ...d.decals.filter((x) => x.kind === 'image' && x.src).map((x) => x.src!)];
    for (const k of keys) {
      if (blobs[k]) continue;
      const rec = await db.blobs.get(k);
      if (rec) blobs[k] = await blobToDataURL(rec.blob);
    }
  }
  return {
    app: 'sole-forge',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    designs,
    blobs,
  };
}

// ---------- マイグレーション & 検証 ----------

type Migration = (file: any) => any;
/** schemaVersion n → n+1 の変換。現在は v1 のみ。v2 を作るときは MIGRATIONS[1] を足す。 */
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: any): BackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('JSON の形式が正しくありません');
  if (raw.app !== 'sole-forge') throw new Error('SOLE FORGE のバックアップファイルではありません');
  let v = Number(raw.schemaVersion ?? 1);
  if (!Number.isInteger(v) || v < 1) throw new Error('schemaVersion が不正です');
  if (v > CURRENT_SCHEMA_VERSION) throw new Error(`新しい版 (v${v}) のファイルです。アプリを更新してください`);
  let file = raw;
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`v${v} からの変換に対応していません`);
    file = m(file);
    v++;
  }
  if (!Array.isArray(file.designs)) throw new Error('designs がありません');
  return {
    app: 'sole-forge',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: String(file.exportedAt ?? ''),
    designs: file.designs.map(sanitizeDesign),
    blobs: typeof file.blobs === 'object' && file.blobs ? file.blobs : {},
  };
}

const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const vec = (v: unknown, f: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], f[0]), num(v[1], f[1]), num(v[2], f[2])] : f;
const hex = (v: unknown, f: string) => (typeof v === 'string' && HEX_RE.test(v) ? v.toUpperCase() : f);

function sanitizePart(id: PartId, raw: any): PartStyle {
  const def = DEFAULT_PARTS[id];
  const out: PartStyle = {
    color: hex(raw?.color, def.color),
    material: MATERIAL_IDS.includes(raw?.material) ? raw.material : def.material,
  };
  if (raw?.pattern && PATTERN_TYPES.includes(raw.pattern.type)) {
    const colors = Array.isArray(raw.pattern.colors) ? raw.pattern.colors.filter((c: unknown) => typeof c === 'string' && HEX_RE.test(c)) : [];
    out.pattern = { type: raw.pattern.type, colors: colors.length ? colors : [out.color, '#C6FF00'] };
    const sc = raw.pattern.scale;
    if (typeof sc === 'number' && Number.isFinite(sc) && sc !== 1) out.pattern.scale = Math.min(PATTERN_SCALE_MAX, Math.max(PATTERN_SCALE_MIN, sc));
    if (PATTERN_DIRECTIONS.includes(raw.pattern.direction) && raw.pattern.direction !== 'h') out.pattern.direction = raw.pattern.direction;
  }
  const f = raw?.finish;
  if (typeof f === 'number' && Number.isFinite(f) && f !== 0) out.finish = Math.min(1, Math.max(-1, f));
  return out;
}

function sanitizeDecal(raw: any): Decal | null {
  if (!raw || !['logo', 'image', 'text'].includes(raw.kind)) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : uid('dc_'),
    kind: raw.kind,
    src: typeof raw.src === 'string' ? raw.src : undefined,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    font: typeof raw.font === 'string' ? raw.font : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
    part: PART_IDS.includes(raw.part) ? raw.part : 'upper',
    position: vec(raw.position, [0, 1, 0.5]),
    normal: vec(raw.normal, [0, 0, 1]),
    scale: num(raw.scale, 0.4),
    rotation: num(raw.rotation, 0),
    flip: !!raw.flip,
    z: num(raw.z, 0),
  };
}

function sanitizeDesign(raw: any, i: number): SneakerDesign {
  const now = new Date().toISOString();
  const parts = {} as Record<PartId, PartStyle>;
  for (const id of PART_IDS) parts[id] = sanitizePart(id, raw?.parts?.[id]);
  const d: SneakerDesign = {
    id: typeof raw?.id === 'string' ? raw.id : uid('d_'),
    name: typeof raw?.name === 'string' ? raw.name.slice(0, 60) : '読み込んだスニーカー',
    baseModel: isBaseModelId(raw?.baseModel) ? raw.baseModel : 'hightop-01',
    parts,
    decals: Array.isArray(raw?.decals) ? (raw.decals.map(sanitizeDecal).filter(Boolean) as Decal[]) : [],
    favorite: !!raw?.favorite,
    shelfOrder: num(raw?.shelfOrder, i),
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  if (raw?.camera?.position && raw?.camera?.target) {
    d.camera = { position: vec(raw.camera.position, [3, 2, 4]), target: vec(raw.camera.target, [0, 1, 0]) };
  }
  if (typeof raw?.thumbnail === 'string') d.thumbnail = raw.thumbnail;
  const shape = normalizeShape(raw?.shape);
  if (Object.keys(shape).length) d.shape = shape;
  return d;
}

export interface ImportResult {
  added: number;
  replaced: number;
}

/**
 * 読み込み。同じ id の作品は上書き（端末間移行で同じ作品を取り込み直せるように）。
 * 新しい作品は棚の末尾に並べる。
 */
export async function importAll(raw: unknown): Promise<ImportResult> {
  const file = migrate(raw);
  const db = getDB();
  let added = 0;
  let replaced = 0;
  await db.transaction('rw', db.designs, db.blobs, async () => {
    const existing = await db.designs.orderBy('shelfOrder').toArray();
    const existingIds = new Set(existing.map((d) => d.id));
    let order = existing.length ? existing[existing.length - 1].shelfOrder + 1 : 0;
    for (const [key, url] of Object.entries(file.blobs)) {
      if (typeof url !== 'string' || !(key.startsWith('img:') || key.startsWith('thumb:'))) continue;
      const blob = dataURLToBlob(url);
      await db.blobs.put({ key, blob, type: blob.type, createdAt: new Date().toISOString() });
    }
    const sorted = [...file.designs].sort((a, b) => a.shelfOrder - b.shelfOrder);
    for (const d of sorted) {
      if (existingIds.has(d.id)) {
        const old = existing.find((e) => e.id === d.id)!;
        await db.designs.put({ ...d, shelfOrder: old.shelfOrder });
        replaced++;
      } else {
        await db.designs.put({ ...d, shelfOrder: order++ });
        added++;
      }
      if (file.blobs[thumbKey(d.id)]) await db.designs.update(d.id, { thumbnail: thumbKey(d.id) });
    }
  });
  return { added, replaced };
}
