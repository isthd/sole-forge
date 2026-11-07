/**
 * ベース型を切り替えたとき、デカールを新しい型の表面へ載せ直す。
 * 高さをアッパーの高さの比率で合わせてから、デカールの向き（法線）に沿って新しい表面へ投影する。
 */
import * as THREE from 'three';
import type { BaseModelDef } from './baseModel';
import { getGeometries } from './baseModel';
import type { Decal, PartId, Vec3 } from './types';
import { PART_IDS } from './types';

const round = (v: number) => Math.round(v * 10000) / 10000;

const meshCache = new Map<string, THREE.Mesh[]>();
function targetsOf(def: BaseModelDef): THREE.Mesh[] {
  let list = meshCache.get(def.key);
  if (!list) {
    const geos = getGeometries(def);
    list = PART_IDS.filter((id) => id !== 'laces').map((id) => {
      const m = new THREE.Mesh(geos[id], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.userData.partId = id;
      m.updateMatrixWorld(true);
      return m;
    });
    meshCache.set(def.key, list);
    // 形の組み合わせは数が多いので、直近のものだけ残す
    if (meshCache.size > 16) meshCache.delete(meshCache.keys().next().value!);
  }
  return list;
}

/** 高さをアッパーの高さの比率で写す（ソールより下はそのまま、ソールの厚み差だけずらす） */
function mapHeight(y: number, from: BaseModelDef, to: BaseModelDef): number {
  const s0 = from.params.soleThickness;
  const s1 = to.params.soleThickness;
  if (y <= s0) return y * (s1 / s0);
  const h0 = from.params.collarBackHeight - s0;
  const h1 = to.params.collarBackHeight - s1;
  return s1 + (y - s0) * (h1 / h0);
}

function cast(targets: THREE.Mesh[], p: THREE.Vector3, n: THREE.Vector3) {
  const ray = new THREE.Raycaster(p.clone().addScaledVector(n, 0.8), n.clone().negate(), 0, 1.8);
  return ray.intersectObjects(targets, false)[0] ?? null;
}

export function reprojectDecals(decals: Decal[], from: BaseModelDef, to: BaseModelDef): Decal[] {
  if (from.key === to.key) return decals;
  const targets = targetsOf(to);
  return decals.map((d) => {
    const p = new THREE.Vector3(d.position[0], mapHeight(d.position[1], from, to), d.position[2]);
    const n = new THREE.Vector3(...d.normal).normalize();
    const side = new THREE.Vector3(0, 0, Math.sign(p.z) || 1);
    // 当たらなければ真横（外側 / 内側）から当て直し、それでも無ければ（履き口より上など）少しずつ下げて探す
    let hit = cast(targets, p, n) ?? cast(targets, p, side);
    for (let i = 0; !hit && i < 12 && p.y > to.params.soleThickness; i++) {
      p.y -= 0.06;
      hit = cast(targets, p, side);
    }
    if (!hit || !hit.face) return d;
    const hn = hit.face.normal.clone();
    if (hn.dot(n) < 0) hn.negate();
    const position: Vec3 = [round(hit.point.x), round(hit.point.y), round(hit.point.z)];
    const normal: Vec3 = [round(hn.x), round(hn.y), round(hn.z)];
    return { ...d, part: hit.object.userData.partId as PartId, position, normal };
  });
}
