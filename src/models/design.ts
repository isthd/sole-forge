import type { BaseModelId, Decal, PartId, PartStyle, SneakerDesign } from './types';
import { CURRENT_SCHEMA_VERSION, PART_IDS } from './types';

export function uid(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  const id = c && 'randomUUID' in c ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + id;
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHex(input: string): string | null {
  let s = input.trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  return HEX_RE.test(s) ? s.toUpperCase() : null;
}

/**
 * 新しい作品の配色。白レザーにグレースエードの補強パーツ、フォームのミッドソール、ガムソール。
 * パーツの重なりとステッチが見える定番の組み合わせにして、最初から靴の作りが読めるようにする。
 */
export const DEFAULT_PARTS: Record<PartId, PartStyle> = {
  upper: { color: '#F2F2EE', material: 'leather' },
  toe: { color: '#F2F2EE', material: 'leather' },
  heel: { color: '#8E8E94', material: 'suede' },
  eyestay: { color: '#8E8E94', material: 'suede' },
  tongue: { color: '#F2F2EE', material: 'mesh' },
  lining: { color: '#2A2A30', material: 'canvas' },
  sidePanel: { color: '#8E8E94', material: 'suede' },
  midsole: { color: '#F4F1E8', material: 'foam' },
  outsole: { color: '#A86A3C', material: 'rubber' },
  laces: { color: '#F2F2EE', material: 'canvas' },
};

export function createDesign(name = '無題のスニーカー', shelfOrder = 0, baseModel: BaseModelId = 'hightop-01'): SneakerDesign {
  const now = new Date().toISOString();
  const parts = {} as Record<PartId, PartStyle>;
  for (const p of PART_IDS) parts[p] = { ...DEFAULT_PARTS[p] };
  return {
    id: uid('d_'),
    name,
    baseModel,
    parts,
    decals: [],
    favorite: false,
    shelfOrder,
    createdAt: now,
    updatedAt: now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export function cloneDesign<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 内側(z<0)⇔外側(z>0) にデカールをミラーコピーする。コピー先側の既存デカールは置き換える。 */
export function mirrorDecals(decals: Decal[], from: 'lateral' | 'medial'): Decal[] {
  const isSource = (d: Decal) => (from === 'lateral' ? d.position[2] >= 0 : d.position[2] < 0);
  const kept = decals.filter((d) => isSource(d) || Math.abs(d.position[2]) < 0.05);
  const maxZ = decals.reduce((m, d) => Math.max(m, d.z), 0);
  const copies: Decal[] = decals
    .filter((d) => isSource(d) && Math.abs(d.position[2]) >= 0.05)
    .map((d, i) => ({
      ...d,
      id: uid('dc_'),
      position: [d.position[0], d.position[1], -d.position[2]],
      normal: [d.normal[0], d.normal[1], -d.normal[2]],
      rotation: -d.rotation,
      flip: !d.flip,
      z: maxZ + 1 + i,
    }));
  return [...kept, ...copies];
}

/** 重ね順を 0..n-1 に詰め直す */
export function normalizeZ(decals: Decal[]): Decal[] {
  const sorted = [...decals].sort((a, b) => a.z - b.z);
  const map = new Map(sorted.map((d, i) => [d.id, i]));
  return decals.map((d) => ({ ...d, z: map.get(d.id)! }));
}
