import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BASE_MODEL_IDS, BASE_MODELS, getBaseModel, getGeometries, countTriangles, PART_IDS } from '../src/models';
import { buildSneakerMeshes } from '../src/renderers/three/meshes';

describe.each(BASE_MODEL_IDS)('%s procedural model', (id) => {
  const def = getBaseModel(id);
  const geos = getGeometries(def);

  it('10 パーツすべてがジオメトリを持つ', () => {
    for (const id of PART_IDS) {
      const g = geos[id];
      expect(g, id).toBeInstanceOf(THREE.BufferGeometry);
      expect(g.getAttribute('position').count, id).toBeGreaterThan(10);
      expect(g.getAttribute('normal'), id).toBeTruthy();
      expect(g.getAttribute('uv'), id).toBeTruthy();
      const pos = g.getAttribute('position').array as Float32Array;
      expect(pos.every((v) => Number.isFinite(v)), id + ' finite').toBe(true);
    }
  });

  it('1 足（左右 2 足分）でも 5 万ポリゴン以下', () => {
    const tris = countTriangles(geos);
    expect(tris * 2).toBeLessThanOrEqual(50000);
  });

  it('パーツ ID と同じ名前のメッシュが 10 個できる', () => {
    const group = buildSneakerMeshes(def);
    const names = group.children.filter((c) => (c as THREE.Mesh).isMesh).map((c) => c.name).sort();
    expect(names).toEqual([...PART_IDS].sort());
  });

  it('寸法が想定範囲（全長 ~3, 高さ = 履き口うしろの高さ前後）', () => {
    const box = new THREE.Box3();
    for (const p of PART_IDS) box.union(geos[p].boundingBox!);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(2.9);
    expect(size.x).toBeLessThan(3.4);
    expect(size.y).toBeGreaterThan(def.params.collarBackHeight - 0.05);
    expect(size.y).toBeLessThan(def.params.collarBackHeight + 0.6);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
  });

  it('登録表の ID と定義の ID が一致し、注視点が靴の高さの中ほど', () => {
    expect(def.id).toBe(id);
    expect(def.label.length).toBeGreaterThan(0);
    expect(def.target[1]).toBeGreaterThan(def.params.soleThickness);
    expect(def.target[1]).toBeLessThan(def.params.collarBackHeight);
  });

  it('ソールは ExtrudeGeometry 由来 / 靴ひもは TubeGeometry 由来でサイズが妥当', () => {
    expect(geos.midsole.boundingBox!.max.y).toBeGreaterThan(0.3);
    expect(geos.laces.boundingBox!.max.y).toBeGreaterThan(1.0);
  });
});

describe('ベース型の種類', () => {
  it('5 種類以上あり、履き口の高さがすべて違う', () => {
    expect(BASE_MODEL_IDS.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(BASE_MODELS).sort()).toEqual([...BASE_MODEL_IDS].sort());
    const heights = BASE_MODEL_IDS.map((id) => getBaseModel(id).params.collarBackHeight + getBaseModel(id).params.soleThickness);
    expect(new Set(heights).size).toBe(heights.length);
  });
});
