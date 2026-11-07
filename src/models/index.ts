import type { BaseModelId, ShapeOptions, SneakerDesign } from './types';
import type { BaseModelDef } from './baseModel';
import { buildSneaker } from './sneakerBuilder';
import { normalizeShape, shapeKey } from './shape';
import { hightop01 } from './hightop01';
import { hicut01 } from './hicut01';
import { midcut01 } from './midcut01';
import { lowtop01 } from './lowtop01';
import { platform01 } from './platform01';

/** ベース型の登録表。型を追加したらここに 1 行足す。 */
export const BASE_MODELS: Record<BaseModelId, BaseModelDef> = {
  'hightop-01': hightop01,
  'hicut-01': hicut01,
  'midcut-01': midcut01,
  'lowtop-01': lowtop01,
  'platform-01': platform01,
};

export function getBaseModel(id: BaseModelId): BaseModelDef {
  return BASE_MODELS[id] ?? hightop01;
}

const shaped = new Map<string, BaseModelDef>();
/**
 * ベース型にパーツの形の選択を組み合わせた定義。すべて標準ならベース型そのもの。
 * 同じ組み合わせには同じオブジェクトを返す（React の依存配列で作り直しを防ぐ）。
 */
export function getDesignModel(id: BaseModelId, shape?: ShapeOptions): BaseModelDef {
  const base = getBaseModel(id);
  const k = shapeKey(shape);
  if (!k) return base;
  const key = base.id + '|' + k;
  let def = shaped.get(key);
  if (!def) {
    const opts = normalizeShape(shape);
    def = { ...base, key, shape: opts, build: () => buildSneaker(base.params, opts) };
    shaped.set(key, def);
  }
  return def;
}

/** 作品の型（ベース型＋形の選択） */
export function modelOf(design: Pick<SneakerDesign, 'baseModel' | 'shape'>): BaseModelDef {
  return getDesignModel(design.baseModel, design.shape);
}

export * from './types';
export * from './design';
export * from './shape';
export type { BaseModelDef, ViewPreset, PartGeometries } from './baseModel';
export { getGeometries, countTriangles } from './baseModel';
