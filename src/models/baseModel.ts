import * as THREE from 'three';
import type { BaseModelId, PartId, Vec3 } from './types';
import { PART_IDS } from './types';
import type { SneakerParams } from './sneakerBuilder';

export type PartGeometries = Record<PartId, THREE.BufferGeometry>;
export type ViewPreset = 'front' | 'side' | 'back' | 'top' | 'threeQuarter';

/** ベース型の定義。寸法パラメータ＋パーツ生成関数。型の追加はこれを満たすファイルを 1 つ足すだけ。 */
export interface BaseModelDef {
  id: BaseModelId;
  label: string;
  /** 選択画面に出す一言説明 */
  description: string;
  params: SneakerParams;
  build: () => PartGeometries;
  /** カメラの注視点 */
  target: Vec3;
  defaultCamera: Vec3;
  presets: Record<ViewPreset, Vec3>;
  /** 両面描画が必要な薄い重ねパーツ */
  doubleSided: PartId[];
}

/** 型ごとにジオメトリを 1 回だけ生成してキャッシュする */
const cache = new Map<string, PartGeometries>();
export function getGeometries(def: BaseModelDef): PartGeometries {
  let g = cache.get(def.id);
  if (!g) {
    g = def.build();
    cache.set(def.id, g);
  }
  return g;
}

export function countTriangles(geos: PartGeometries): number {
  let n = 0;
  for (const id of PART_IDS) {
    const g = geos[id];
    n += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
  }
  return n;
}
