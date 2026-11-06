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

export type MaterialId = 'leather' | 'suede' | 'mesh' | 'canvas' | 'patent';
export type PatternType = 'gradient' | 'camo' | 'check' | 'dot';

export interface PartStyle {
  color: string; // HEX
  material: MaterialId;
  pattern?: { type: PatternType; colors: string[] };
}

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

export type BaseModelId = 'hightop-01' | 'midcut-01' | 'lowtop-01' | 'platform-01';
/** ベース型の ID（選択画面の表示順）。型を追加したらここと models/index.ts の登録表に足す */
export const BASE_MODEL_IDS: BaseModelId[] = ['hightop-01', 'midcut-01', 'lowtop-01', 'platform-01'];
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

export const MATERIAL_IDS: MaterialId[] = ['leather', 'suede', 'mesh', 'canvas', 'patent'];
export const MATERIAL_LABELS: Record<MaterialId, string> = {
  leather: 'レザー',
  suede: 'スエード',
  mesh: 'メッシュ',
  canvas: 'キャンバス',
  patent: 'パテント',
};

export const PATTERN_TYPES: PatternType[] = ['gradient', 'camo', 'check', 'dot'];
export const PATTERN_LABELS: Record<PatternType, string> = {
  gradient: 'グラデーション',
  camo: '迷彩',
  check: 'チェック',
  dot: 'ドット',
};

export const CURRENT_SCHEMA_VERSION = 1 as const;
