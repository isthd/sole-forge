// 企画書「データモデル」をそのまま型にしたもの。
export type PartId =
  | 'upper'
  | 'toe'
  | 'heel'
  | 'eyestay'
  | 'tongue'
  | 'lining'
  | 'midsole'
  | 'outsole'
  | 'laces'
  | 'sidePanel';

export type MaterialId = 'leather' | 'suede' | 'mesh' | 'canvas' | 'patent' | 'knit' | 'metallic' | 'rubber' | 'foam';
export type PatternType = 'gradient' | 'camo' | 'check' | 'dot' | 'stripe' | 'splatter' | 'marble';
/** 柄の向き（ストライプ用）。h = 横縞、v = 縦縞、d = 斜め */
export type PatternDirection = 'h' | 'v' | 'd';

export interface PatternStyle {
  type: PatternType;
  colors: string[];
  /** 柄の大きさの倍率（0.5〜2、省略時 1）。グラデーションには効かない */
  scale?: number;
  /** ストライプの向き（省略時 h） */
  direction?: PatternDirection;
}

export interface PartStyle {
  color: string; // HEX
  material: MaterialId;
  pattern?: PatternStyle;
  /** ツヤ（-1 = マット 〜 0 = 素材なり 〜 1 = 光沢、省略時 0） */
  finish?: number;
}

/**
 * パーツの形の選択（作品ごと）。省略した項目は標準の形。
 * 値を追加したら models/shape.ts の SHAPE_OPTIONS にも足す。
 */
export interface ShapeOptions {
  toeCap?: 'standard' | 'short' | 'long' | 'straight';
  heelCounter?: 'standard' | 'low' | 'high';
  /** auto = ベース型の標準（ランナーは有り、ほかは無し） */
  pullTab?: 'auto' | 'none' | 'short' | 'long';
  sidePanel?: 'hex' | 'oval' | 'diamond' | 'saddle';
  tongue?: 'standard' | 'short' | 'long';
  eyelets?: '7' | '6' | '5';
  laceWidth?: 'standard' | 'thin' | 'thick';
  laceStyle?: 'cross' | 'bar';
  laceTie?: 'bow' | 'tucked';
}
export type ShapeKey = keyof ShapeOptions;

export type Vec3 = [number, number, number];

export interface Decal {
  id: string;
  kind: 'logo' | 'image' | 'text';
  src?: string; // 画像は Blob のキー / ロゴは付属ロゴ ID
  text?: string;
  font?: string;
  color?: string;
  part: PartId; // 貼り付け先パーツ（メッシュ名）
  position: Vec3; // モデル表面上の位置（モデル座標）
  normal: Vec3; // 投影方向
  scale: number;
  rotation: number; // 度
  flip: boolean;
  z: number; // 重ね順
}

export type BaseModelId = 'hightop-01' | 'hicut-01' | 'midcut-01' | 'lowtop-01' | 'platform-01';
/** ベース型の ID（選択画面の表示順）。型を追加したらここと models/index.ts の登録表に足す */
export const BASE_MODEL_IDS: BaseModelId[] = ['hightop-01', 'hicut-01', 'midcut-01', 'lowtop-01', 'platform-01'];
export function isBaseModelId(v: unknown): v is BaseModelId {
  return typeof v === 'string' && (BASE_MODEL_IDS as string[]).includes(v);
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export interface SneakerDesign {
  id: string;
  name: string;
  baseModel: BaseModelId;
  parts: Record<PartId, PartStyle>;
  /** パーツの形（省略 = すべて標準） */
  shape?: ShapeOptions;
  decals: Decal[];
  camera?: CameraState; // 最後に見ていた角度
  thumbnail?: string; // 棚表示用 PNG の Blob キー
  favorite: boolean;
  shelfOrder: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export const PART_IDS: PartId[] = [
  'upper',
  'toe',
  'heel',
  'eyestay',
  'tongue',
  'lining',
  'sidePanel',
  'midsole',
  'outsole',
  'laces',
];

export const PART_LABELS: Record<PartId, string> = {
  upper: 'アッパー',
  toe: 'トゥ',
  heel: 'ヒールカウンター',
  eyestay: 'アイステイ',
  tongue: 'シュータン',
  lining: 'ライニング',
  sidePanel: 'サイドパネル',
  midsole: 'ミッドソール',
  outsole: 'アウトソール',
  laces: '靴ひも',
};

export const MATERIAL_IDS: MaterialId[] = ['leather', 'suede', 'mesh', 'canvas', 'patent', 'knit', 'metallic', 'rubber', 'foam'];
export const MATERIAL_LABELS: Record<MaterialId, string> = {
  leather: 'レザー',
  suede: 'スエード',
  mesh: 'メッシュ',
  canvas: 'キャンバス',
  patent: 'パテント',
  knit: 'ニット',
  metallic: 'メタリック',
  rubber: 'ラバー',
  foam: 'フォーム',
};

export const PATTERN_TYPES: PatternType[] = ['gradient', 'camo', 'check', 'dot', 'stripe', 'splatter', 'marble'];
export const PATTERN_LABELS: Record<PatternType, string> = {
  gradient: 'グラデーション',
  camo: '迷彩',
  check: 'チェック',
  dot: 'ドット',
  stripe: 'ストライプ',
  splatter: 'スプラッター',
  marble: 'マーブル',
};
export const PATTERN_DIRECTIONS: PatternDirection[] = ['h', 'v', 'd'];
export const PATTERN_DIRECTION_LABELS: Record<PatternDirection, string> = { h: '横', v: '縦', d: '斜め' };
export const PATTERN_SCALE_MIN = 0.5;
export const PATTERN_SCALE_MAX = 2;

export const CURRENT_SCHEMA_VERSION = 1 as const;
