import type { BaseModelId } from './types';
import type { BaseModelDef } from './baseModel';
import { hightop01 } from './hightop01';
import { midcut01 } from './midcut01';
import { lowtop01 } from './lowtop01';
import { platform01 } from './platform01';

/** ベース型の登録表。型を追加したらここに 1 行足す。 */
export const BASE_MODELS: Record<BaseModelId, BaseModelDef> = {
  'hightop-01': hightop01,
  'midcut-01': midcut01,
  'lowtop-01': lowtop01,
  'platform-01': platform01,
};

export function getBaseModel(id: BaseModelId): BaseModelDef {
  return BASE_MODELS[id] ?? hightop01;
}

export * from './types';
export * from './design';
export type { BaseModelDef, ViewPreset, PartGeometries } from './baseModel';
export { getGeometries, countTriangles } from './baseModel';
