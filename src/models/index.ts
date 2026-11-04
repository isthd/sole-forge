import type { BaseModelId } from './types';
import type { BaseModelDef } from './baseModel';
import { hightop01 } from './hightop01';

/** ベース型の登録表。型を追加したらここに 1 行足す。 */
export const BASE_MODELS: Record<BaseModelId, BaseModelDef> = {
  'hightop-01': hightop01,
};

export function getBaseModel(id: BaseModelId): BaseModelDef {
  return BASE_MODELS[id] ?? hightop01;
}

export * from './types';
export * from './design';
export type { BaseModelDef, ViewPreset, PartGeometries } from './baseModel';
export { getGeometries, countTriangles } from './baseModel';
