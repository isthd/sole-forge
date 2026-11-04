import * as THREE from 'three';
import type { BaseModelDef } from '../../models/baseModel';
import { getGeometries } from '../../models/baseModel';
import { PART_IDS } from '../../models/types';

/** パーツ ID と同じ名前のメッシュを持つグループを作る（素材は後から差し替える） */
export function buildSneakerMeshes(def: BaseModelDef): THREE.Group {
  const geos = getGeometries(def);
  const group = new THREE.Group();
  group.name = 'sneaker';
  for (const id of PART_IDS) {
    const mesh = new THREE.Mesh(geos[id], new THREE.MeshStandardMaterial());
    mesh.name = id;
    mesh.userData.partId = id;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
