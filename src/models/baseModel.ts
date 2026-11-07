import * as THREE from 'three';
import type { BaseModelId, PartId, ShapeOptions, Vec3 } from './types';
import { PART_IDS } from './types';
import type { SneakerParams } from './sneakerBuilder';

export type PartGeometries = Record<PartId, THREE.BufferGeometry>;
export type ViewPreset = 'front' | 'side' | 'back' | 'top' | 'threeQuarter';

/** ベース型の定義。寸法パラメータ＋パーツ生成関数。型の追加はこれを満たすファイルを 1 つ足すだけ。 */
export interface BaseModelDef {
  id: BaseModelId;
  /** ジオメトリのキャッシュキー。ベース型そのものは id、形の選択を組み合わせたものは id|形 */
  key: string;
  /** 組み合わせた形の選択（ベース型そのものは省略） */
  shape?: ShapeOptions;
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

/** 型（＋形の選択）ごとにジオメトリを 1 回だけ生成してキャッシュする */
const cache = new Map<string, PartGeometries>();
/** 形の組み合わせのキャッシュはこの数まで（古いものから捨てる。ベース型そのものは捨てない） */
const SHAPED_CACHE_LIMIT = 12;
export function getGeometries(def: BaseModelDef): PartGeometries {
  let g = cache.get(def.key);
  if (g) {
    // 最近使ったものを末尾へ
    cache.delete(def.key);
    cache.set(def.key, g);
    return g;
  }
  g = def.build();
  cache.set(def.key, g);
  const shaped = [...cache.keys()].filter((k) => k.includes('|'));
  for (const k of shaped.slice(0, Math.max(0, shaped.length - SHAPED_CACHE_LIMIT))) {
    // GPU 側のバッファだけ解放（まだ表示中なら three.js が再転送する）
    for (const geo of Object.values(cache.get(k)!)) geo.dispose();
    cache.delete(k);
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
