/**
 * 作品データ → Three.js オブジェクト のレンダラー。
 * React (R3F) のビューと、PNG 書き出し用のオフスクリーン描画の両方からこのクラスを使う。
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { BaseModelDef } from '../../models/baseModel';
import type { Decal, PartId, PartStyle } from '../../models/types';
import { PART_IDS } from '../../models/types';
import { buildSneakerMeshes } from './meshes';
import { MATERIAL_SPECS, PATTERN_TILE, getNormalMap, getPatternTexture, getShadowTexture } from './textures';
import { getDecalTexture } from './decalTextures';

const ACCENT = new THREE.Color('#C6FF00');

export class SneakerView {
  readonly root = new THREE.Group();
  readonly meshes = {} as Record<PartId, THREE.Mesh>;
  private readonly decalGroup = new THREE.Group();
  private partKeys = {} as Record<PartId, string>;
  private decalMeshes = new Map<string, { key: string; mesh: THREE.Mesh }>();
  private wantedKeys = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();
  readonly shadow: THREE.Mesh;

  constructor(
    readonly def: BaseModelDef,
    private readonly onChange: () => void = () => {},
  ) {
    const g = buildSneakerMeshes(def);
    for (const child of [...g.children]) {
      const m = child as THREE.Mesh;
      this.meshes[m.name as PartId] = m;
      this.root.add(m);
    }
    this.decalGroup.name = 'decals';
    this.root.add(this.decalGroup);
    this.root.name = 'sneaker-root';
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.2),
      new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.name = 'shadow';
    this.shadow.raycast = () => {};
    this.root.add(this.shadow);
  }

  setParts(parts: Record<PartId, PartStyle>, highlight: PartId | null) {
    for (const id of PART_IDS) {
      const style = parts[id];
      const key = JSON.stringify(style) + (highlight === id ? '*' : '');
      if (this.partKeys[id] === key) continue;
      this.partKeys[id] = key;
      const mesh = this.meshes[id];
      const old = mesh.material as THREE.Material;
      mesh.material = this.makeMaterial(id, style, highlight === id);
      disposeMaterial(old);
    }
    this.onChange();
  }

  private makeMaterial(id: PartId, style: PartStyle, highlighted: boolean): THREE.MeshPhysicalMaterial {
    const spec = MATERIAL_SPECS[style.material];
    const uvSize = (this.meshes[id].geometry.userData.uvSize as [number, number]) ?? [1, 1];
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(style.pattern ? '#FFFFFF' : style.color),
      roughness: spec.roughness,
      metalness: spec.metalness,
      clearcoat: spec.clearcoat ?? 0,
      clearcoatRoughness: spec.clearcoatRoughness ?? 0,
      sheen: spec.sheen ?? 0,
      sheenRoughness: spec.sheenRoughness ?? 1,
      envMapIntensity: spec.envMapIntensity,
      side: this.def.doubleSided.includes(id) ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (spec.sheen) mat.sheenColor = new THREE.Color(style.color).lerp(new THREE.Color('#FFFFFF'), 0.35);
    const nm = getNormalMap(style.material);
    if (nm && spec.normalScale > 0) {
      const t = nm.clone();
      t.repeat.set(Math.max(1, Math.round(uvSize[0] * spec.density)), Math.max(1, Math.round(uvSize[1] * spec.density)));
      mat.normalMap = t;
      mat.normalScale = new THREE.Vector2(spec.normalScale, spec.normalScale);
    }
    if (style.pattern) {
      const base = getPatternTexture(style.pattern.type, style.pattern.colors);
      const t = base.clone();
      const tile = PATTERN_TILE[style.pattern.type];
      if (tile > 0) t.repeat.set(Math.max(1, Math.round(uvSize[0] / tile)), Math.max(1, Math.round(uvSize[1] / tile)));
      mat.map = t;
    }
    if (highlighted) {
      mat.emissive = ACCENT.clone();
      mat.emissiveIntensity = 0.22;
    }
    return mat;
  }

  /** デカールを差分更新。テクスチャ読み込みを待つ Promise を返す。 */
  setDecals(decals: Decal[], selectedId: string | null): Promise<void> {
    const wanted = new Set(decals.map((d) => d.id));
    this.wantedKeys.clear();
    for (const [id, entry] of this.decalMeshes) {
      if (!wanted.has(id)) {
        this.removeDecalMesh(entry.mesh);
        this.decalMeshes.delete(id);
      }
    }
    const tasks: Promise<void>[] = [];
    for (const d of decals) {
      const key = JSON.stringify(d) + (d.id === selectedId ? '*' : '');
      this.wantedKeys.set(d.id, key);
      const cur = this.decalMeshes.get(d.id);
      if (cur && cur.key === key) continue;
      tasks.push(
        getDecalTexture(d).then(({ texture, aspect }) => {
          if (this.wantedKeys.get(d.id) !== key) return; // もっと新しい更新が来ている
          const mesh = this.buildDecalMesh(d, texture, aspect, d.id === selectedId);
          const prev = this.decalMeshes.get(d.id);
          if (prev) this.removeDecalMesh(prev.mesh);
          if (!mesh) {
            this.decalMeshes.delete(d.id);
            return;
          }
          this.decalGroup.add(mesh);
          this.decalMeshes.set(d.id, { key, mesh });
        }),
      );
    }
    this.pending = Promise.all(tasks).then(() => this.onChange());
    this.onChange();
    return this.pending;
  }

  whenReady() {
    return this.pending;
  }

  private buildDecalMesh(d: Decal, texture: THREE.Texture, aspect: number, selected: boolean): THREE.Mesh | null {
    const target = this.meshes[d.part];
    if (!target) return null;
    const n = new THREE.Vector3(...d.normal).normalize();
    if (n.lengthSq() < 0.5) n.set(0, 0, 1);
    const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, n).normalize();
    const y = new THREE.Vector3().crossVectors(n, x);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(n, (-d.rotation * Math.PI) / 180));
    const w = aspect >= 1 ? d.scale : d.scale * aspect;
    const h = aspect >= 1 ? d.scale / aspect : d.scale;
    const depth = Math.min(0.45, Math.max(0.18, Math.max(w, h) * 0.6));
    // パーツのジオメトリをモデル座標のまま投影する（matrixWorld = 単位行列のプロキシ）
    const proxy = new THREE.Mesh(target.geometry);
    proxy.updateMatrixWorld(true);
    let geo: THREE.BufferGeometry;
    try {
      geo = new DecalGeometry(proxy, new THREE.Vector3(...d.position), new THREE.Euler().setFromQuaternion(q), new THREE.Vector3(w, h, depth));
    } catch {
      return null;
    }
    if (geo.getAttribute('position').count === 0) {
      geo.dispose();
      // 投影先に面が無いときも位置が分かるよう空メッシュで保持
      return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
    }
    let map = texture;
    if (d.flip) {
      map = texture.clone();
      map.repeat.x = -1;
      map.offset.x = 1;
    }
    const mat = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4 - d.z * 2,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    if (selected) {
      mat.emissive = ACCENT.clone();
      mat.emissiveIntensity = 0.25;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10 + d.z;
    mesh.name = 'decal:' + d.id;
    mesh.userData.decalId = d.id;
    return mesh;
  }

  private removeDecalMesh(mesh: THREE.Mesh) {
    this.decalGroup.remove(mesh);
    mesh.geometry.dispose();
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.map && m.map.repeat.x === -1) m.map.dispose();
    m.dispose();
  }

  dispose() {
    for (const id of PART_IDS) disposeMaterial(this.meshes[id].material as THREE.Material);
    for (const { mesh } of this.decalMeshes.values()) this.removeDecalMesh(mesh);
    this.decalMeshes.clear();
    (this.shadow.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
  }
}

function disposeMaterial(m: THREE.Material) {
  const mm = m as THREE.MeshPhysicalMaterial;
  // clone したテクスチャ（repeat 用）だけ破棄。元画像（Source）は共有なので残る
  mm.normalMap?.dispose();
  mm.map?.dispose();
  m.dispose();
}

/** 共通のライティング（環境光はコードで生成した RoomEnvironment を使い、外部 HDR は読まない） */
export function addStageLights(scene: THREE.Object3D) {
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 6, 4);
  const rim = new THREE.DirectionalLight('#dfe8ff', 0.9);
  rim.position.set(-5, 3, -3);
  const fill = new THREE.HemisphereLight('#ffffff', '#2a2a30', 0.35);
  scene.add(key, rim, fill);
  return [key, rim, fill];
}
