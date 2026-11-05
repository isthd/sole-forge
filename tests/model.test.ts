import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getBaseModel, getGeometries, countTriangles, PART_IDS } from '../src/models';
import { buildSneakerMeshes } from '../src/renderers/three/meshes';

describe('hightop-01 procedural model', () => {
  const def = getBaseModel('hightop-01');
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

  it('寸法が想定範囲（全長 ~3, 高さ ~1.5 のローカット）', () => {
    const box = new THREE.Box3();
    for (const id of PART_IDS) box.union(geos[id].boundingBox!);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(2.9);
    expect(size.x).toBeLessThan(3.4);
    expect(size.y).toBeGreaterThan(1.3);
    expect(size.y).toBeLessThan(1.9);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
  });

  it('ソールは ExtrudeGeometry 由来 / 靴ひもは TubeGeometry 由来でサイズが妥当', () => {
    expect(geos.midsole.boundingBox!.max.y).toBeGreaterThan(0.3);
    expect(geos.laces.boundingBox!.max.y).toBeGreaterThan(0.9);
  });
});
