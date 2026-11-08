/**
 * パーツの形の選択肢（トゥキャップの大きさ・サイドパネルの形・靴ひもの太さ など）。
 * 作品の shape に保存し、ベース型の寸法と組み合わせてジオメトリを作る。
 */
import type { PartId, ShapeKey, ShapeOptions } from './types';

export interface ShapeChoice {
  value: string;
  label: string;
}

export interface ShapeOptionDef {
  key: ShapeKey;
  label: string;
  /** 省略時の値 */
  default: string;
  choices: ShapeChoice[];
}

export const SHAPE_OPTIONS: Record<ShapeKey, ShapeOptionDef> = {
  toeCap: {
    key: 'toeCap',
    label: 'トゥキャップ',
    default: 'standard',
    choices: [
      { value: 'standard', label: '標準' },
      { value: 'short', label: 'ショート' },
      { value: 'long', label: 'ロング' },
      { value: 'straight', label: 'ストレート' },
    ],
  },
  heelCounter: {
    key: 'heelCounter',
    label: 'ヒールの高さ',
    default: 'standard',
    choices: [
      { value: 'low', label: '低め' },
      { value: 'standard', label: '標準' },
      { value: 'high', label: '高め' },
    ],
  },
  pullTab: {
    key: 'pullTab',
    label: 'プルタブ',
    default: 'auto',
    choices: [
      { value: 'auto', label: '型の標準' },
      { value: 'none', label: 'なし' },
      { value: 'short', label: 'ショート' },
      { value: 'long', label: 'ロング' },
    ],
  },
  sidePanel: {
    key: 'sidePanel',
    label: 'パネルの形',
    default: 'hex',
    choices: [
      { value: 'hex', label: '六角' },
      { value: 'oval', label: '楕円' },
      { value: 'diamond', label: 'ダイヤ' },
      { value: 'saddle', label: 'サドル' },
      { value: 'quarter', label: 'クォーター' },
    ],
  },
  mudguard: {
    key: 'mudguard',
    label: 'マッドガード',
    default: 'none',
    choices: [
      { value: 'none', label: 'なし' },
      { value: 'low', label: '低め' },
      { value: 'high', label: '高め' },
    ],
  },
  tongue: {
    key: 'tongue',
    label: 'シュータンの長さ',
    default: 'standard',
    choices: [
      { value: 'short', label: 'ショート' },
      { value: 'standard', label: '標準' },
      { value: 'long', label: 'ロング' },
    ],
  },
  eyelets: {
    key: 'eyelets',
    label: 'ハトメの数（片側）',
    default: '7',
    choices: [
      { value: '5', label: '5 個' },
      { value: '6', label: '6 個' },
      { value: '7', label: '7 個' },
    ],
  },
  laceWidth: {
    key: 'laceWidth',
    label: 'ひもの太さ',
    default: 'standard',
    choices: [
      { value: 'thin', label: '細' },
      { value: 'standard', label: '標準' },
      { value: 'thick', label: '太' },
    ],
  },
  laceStyle: {
    key: 'laceStyle',
    label: '通し方',
    default: 'cross',
    choices: [
      { value: 'cross', label: 'クロス' },
      { value: 'bar', label: 'ストレート' },
    ],
  },
  laceTie: {
    key: 'laceTie',
    label: '結び方',
    default: 'bow',
    choices: [
      { value: 'bow', label: '蝶結び' },
      { value: 'tucked', label: '結ばない' },
    ],
  },
};

export const SHAPE_KEYS = Object.keys(SHAPE_OPTIONS) as ShapeKey[];

/** パーツごとに出す形の項目（形の項目が無いパーツは空） */
export const PART_SHAPE_KEYS: Record<PartId, ShapeKey[]> = {
  upper: [],
  toe: ['toeCap', 'mudguard'],
  heel: ['heelCounter', 'pullTab'],
  eyestay: ['eyelets'],
  tongue: ['tongue'],
  lining: [],
  sidePanel: ['sidePanel'],
  midsole: [],
  outsole: [],
  laces: ['laceWidth', 'laceStyle', 'laceTie', 'eyelets'],
};

export function isShapeValue<K extends ShapeKey>(key: K, v: unknown): v is NonNullable<ShapeOptions[K]> {
  return typeof v === 'string' && SHAPE_OPTIONS[key].choices.some((c) => c.value === v);
}

/** 不正な値と標準の値を取り除く（標準の形は保存しない。キャッシュのキーも揃う） */
export function normalizeShape(raw: unknown): ShapeOptions {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of SHAPE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (isShapeValue(key, v) && v !== SHAPE_OPTIONS[key].default) out[key] = v;
  }
  return out as ShapeOptions;
}

/** 形の選択を表す短い文字列（ジオメトリのキャッシュキー）。すべて標準なら空文字 */
export function shapeKey(shape: ShapeOptions | undefined): string {
  const n = normalizeShape(shape);
  return SHAPE_KEYS.filter((k) => n[k] !== undefined)
    .map((k) => `${k}=${n[k]}`)
    .join(',');
}

export function shapeValue<K extends ShapeKey>(shape: ShapeOptions | undefined, key: K): NonNullable<ShapeOptions[K]> {
  const v = shape?.[key];
  return (isShapeValue(key, v) ? v : SHAPE_OPTIONS[key].default) as NonNullable<ShapeOptions[K]>;
}
