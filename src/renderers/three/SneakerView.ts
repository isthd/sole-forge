/**
 * 作品データ → Three.js オブジェクト のレンダラー。
 * React (R3F) のビューと、PNG 書き出し用のオフスクリーン描画の両方からこのクラスを使う。
 *
 * エディタでは「制作過程」も 3D で見せる（animate オプション）:
 *  - 色・柄の変更 … スプレー缶が吹き付け、起点から塗料が広がって、塗りたての艶が乾いていく
 *  - 素材の変更 … ライムの継ぎ目が走って新しい素材に張り替わる
 *  - デカールの追加 … ステッカーが浮いた状態で近づき、ヘラで端から押し付けられる。削除ではめくれてはがれる
 * オフスクリーン描画（サムネイル・書き出し）では animate を渡さないので、常に完成した状態を描く。
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { BaseModelDef } from '../../models/baseModel';
import type { Decal, PartId, PartStyle, Vec3 } from '../../models/types';
import { PART_IDS } from '../../models/types';
import { buildSneakerMeshes } from './meshes';
import { MATERIAL_SPECS, PATTERN_TILE, getNormalMap, getPatternTexture, getShadowTexture, surfaceOf } from './textures';
import { getDecalTexture } from './decalTextures';
import {
  APPLY_DURATION,
  REMOVE_DURATION,
  SPECKLE_BAND,
  WET_ENV_BOOST,
  WET_ROUGHNESS,
  applyPose,
  changedParts,
  coverRadius,
  decalBasis,
  decalSize,
  dryFactor,
  paintDuration,
  paintRadius,
  removePose,
  staggerDelays,
  type ChangeKind,
  type DecalBasis,
} from './fx/processMath';
import { makePaintOverlay, type PaintUniforms } from './fx/paintFx';
import { SprayRig, type PartSamples } from './fx/sprayCan';
import { buildSqueegee, disposeGroup, patchSticker, type StickerUniforms } from './fx/stickerFx';

const ACCENT = new THREE.Color('#C6FF00');
const BLACK = new THREE.Color('#000000');
const SQUEEGEE_TILT = 0.5;

/** 塗りの起点（モデルをタップした位置） */
export interface PaintOrigin {
  part: PartId;
  position: Vec3;
  normal: Vec3;
}

export interface SetPartsOptions {
  /** 変更を塗り広げの演出つきで反映する */
  animate?: boolean;
  /** 起点。パーツが一致しなければカメラから見える位置を自動で選ぶ */
  origin?: PaintOrigin | null;
  /** カメラ位置（ワールド座標） */
  eye?: THREE.Vector3 | null;
}

/** 貼り付け前のプレビュー（ゴースト） */
export type DecalPreview = Pick<Decal, 'kind' | 'src' | 'text' | 'font' | 'color' | 'scale' | 'rotation' | 'flip' | 'part' | 'position' | 'normal'>;

/** 塗り重ねの 1 層（変更前の見た目を持ち、起点から消えていく） */
interface PaintTransition {
  kind: ChangeKind;
  overlay: THREE.Mesh | null;
  uniforms: PaintUniforms;
  start: number;
  delay: number;
  duration: number;
  cover: number;
}

/** パーツごとの塗り重ね（古い層ほど手前）と、塗りたての艶 */
interface PartPaint {
  layers: PaintTransition[];
  lastChange: number;
  dry: { start: number; duration: number } | null;
}

/** これより短い間隔の変更は「ドラッグ中」とみなし、層を重ねずに色だけ差し替える */
const LIVE_CHANGE_MS = 250;
/** 同時に重ねる層の上限（デカールの深度オフセット -4 より手前に出ないように） */
const MAX_LAYERS = 3;

interface DecalEntry {
  key: string;
  mesh: THREE.Mesh;
  aspect: number;
  sticker: StickerUniforms | null;
}

interface StickerAnim {
  mode: 'apply' | 'remove';
  mesh: THREE.Mesh;
  u: StickerUniforms;
  start: number;
  tool: THREE.Group | null;
  center: THREE.Vector3;
  basis: DecalBasis;
  w: number;
  h: number;
}

export interface FxStats {
  paints: number;
  overlays: number;
  stickers: number;
  can: boolean;
  particles: number;
  ghost: boolean;
}

export class SneakerView {
  readonly root = new THREE.Group();
  readonly meshes = {} as Record<PartId, THREE.Mesh>;
  private readonly decalGroup = new THREE.Group();
  private readonly fxGroup = new THREE.Group();
  private partKeys = {} as Record<PartId, string>;
  private styles: Record<PartId, PartStyle> | null = null;
  private decalMeshes = new Map<string, DecalEntry>();
  private wantedKeys = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();
  private paints = new Map<PartId, PartPaint>();
  private spray: SprayRig | null = null;
  private samples = new Map<PartId, PartSamples>();
  private stickers: StickerAnim[] = [];
  private knownDecals: Set<string> | null = null;
  private pendingApply = new Set<string>();
  private selectedDecal: string | null = null;
  private ghostMesh: THREE.Mesh | null = null;
  private ghostSeq = 0;
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
    this.fxGroup.name = 'fx';
    this.root.add(this.decalGroup, this.fxGroup);
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

  // ------------------------------------------------------------------ パーツ

  setParts(parts: Record<PartId, PartStyle>, highlight: PartId | null, opts: SetPartsOptions = {}) {
    const prev = this.styles;
    const changes = opts.animate && prev ? changedParts(prev, parts) : [];
    this.styles = parts;
    const now = performance.now();
    const delays = staggerDelays(changes.length, 0.11);
    const started: { part: PartId; tr: PaintTransition; origin: THREE.Vector3; normal: THREE.Vector3 }[] = [];
    for (const id of PART_IDS) {
      const style = parts[id];
      const key = JSON.stringify(style);
      if (this.partKeys[id] === key) continue;
      this.partKeys[id] = key;
      const mesh = this.meshes[id];
      const old = mesh.material as THREE.MeshPhysicalMaterial;
      mesh.material = this.makeMaterial(id, style);
      const ci = changes.findIndex((c) => c.part === id);
      if (ci < 0) {
        this.cancelPaint(id);
        disposeMaterial(old);
        continue;
      }
      const res = this.startPaint(id, changes[ci].kind, old, style, delays[ci], now, opts);
      if (res) started.push({ part: id, ...res });
    }
    this.applyHighlight(highlight);
    this.queueSpray(started, parts, now);
    this.onChange();
  }

  private makeMaterial(id: PartId, style: PartStyle): THREE.MeshPhysicalMaterial {
    const spec = MATERIAL_SPECS[style.material];
    const geo = this.meshes[id].geometry;
    const uvSize = (geo.userData.uvSize as [number, number]) ?? [1, 1];
    // アッパーの表面のパーツは共通の座標 uv1 を持つ。素材の凹凸とタイル柄をそこに貼ると、
    // 同じ素材・柄どうしならパーツの境目でシボや柄が途切れず、境界線が出ない
    const skinSize = geo.getAttribute('uv1') ? (geo.userData.uv1Size as [number, number] | undefined) ?? null : null;
    const tileSize = skinSize ?? uvSize;
    const surf = surfaceOf(style);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(style.pattern ? '#FFFFFF' : style.color),
      roughness: surf.roughness,
      metalness: spec.metalness,
      clearcoat: surf.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness ?? 0.08,
      sheen: spec.sheen ?? 0,
      sheenRoughness: spec.sheenRoughness ?? 1,
      envMapIntensity: surf.envMapIntensity,
      side: this.def.doubleSided.includes(id) ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (spec.sheen) mat.sheenColor = new THREE.Color(style.color).lerp(new THREE.Color('#FFFFFF'), 0.35);
    const nm = getNormalMap(style.material);
    if (nm && spec.normalScale > 0) {
      const t = nm.clone();
      t.repeat.set(Math.max(1, Math.round(tileSize[0] * spec.density)), Math.max(1, Math.round(tileSize[1] * spec.density)));
      if (skinSize) t.channel = 1;
      mat.normalMap = t;
      mat.normalScale = new THREE.Vector2(spec.normalScale, spec.normalScale);
    }
    if (style.pattern) {
      const base = getPatternTexture(style.pattern.type, style.pattern.colors, style.pattern.direction);
      const t = base.clone();
      const tile = PATTERN_TILE[style.pattern.type] * (style.pattern.scale ?? 1);
      // グラデーションはパーツごとに下→上で 1 回（従来どおり uv）。タイル柄は共通の座標でつなげる
      if (tile > 0) {
        t.repeat.set(Math.max(1, Math.round(tileSize[0] / tile)), Math.max(1, Math.round(tileSize[1] / tile)));
        if (skinSize) t.channel = 1;
      }
      mat.map = t;
    }
    return mat;
  }

  /** 選んだパーツを一瞬光らせる（マテリアルは作り直さずに発光だけ変える） */
  private applyHighlight(highlight: PartId | null) {
    for (const id of PART_IDS) {
      const mat = this.meshes[id].material as THREE.MeshPhysicalMaterial;
      const on = highlight === id;
      mat.emissive.copy(on ? ACCENT : BLACK);
      mat.emissiveIntensity = on ? 0.22 : 1;
    }
  }

  private getSamples(id: PartId): PartSamples {
    let s = this.samples.get(id);
    if (s) return s;
    const g = this.meshes[id].geometry;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const step = Math.max(1, Math.floor(pos.count / 320));
    const count = Math.floor(pos.count / step);
    const p = new Float32Array(count * 3);
    const n = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const i = k * step;
      p.set([pos.getX(i), pos.getY(i), pos.getZ(i)], k * 3);
      n.set(nor ? [nor.getX(i), nor.getY(i), nor.getZ(i)] : [0, 1, 0], k * 3);
    }
    s = { p, n, count };
    this.samples.set(id, s);
    return s;
  }

  /** 起点が無いとき: カメラからパーツの中心へ向かう線がパーツに当たる点（見えている面） */
  private defaultOrigin(id: PartId, eye: THREE.Vector3 | null | undefined): { origin: THREE.Vector3; normal: THREE.Vector3 } {
    const mesh = this.meshes[id];
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const center = geo.boundingBox!.getCenter(new THREE.Vector3());
    this.root.updateMatrixWorld(true);
    if (eye) {
      const eyeLocal = this.root.worldToLocal(eye.clone());
      const dir = center.clone().sub(eyeLocal).normalize();
      const ray = new THREE.Raycaster(eye.clone(), this.root.localToWorld(center.clone()).sub(eye).normalize());
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit && hit.face) {
        const n = hit.face.normal.clone();
        if (n.dot(dir) > 0) n.negate();
        return { origin: this.root.worldToLocal(hit.point.clone()), normal: n };
      }
      // 当たらなければカメラに一番近い頂点
      const s = this.getSamples(id);
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < s.count; i++) {
        const d = (s.p[i * 3] - eyeLocal.x) ** 2 + (s.p[i * 3 + 1] - eyeLocal.y) ** 2 + (s.p[i * 3 + 2] - eyeLocal.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return {
        origin: new THREE.Vector3(s.p[best * 3], s.p[best * 3 + 1], s.p[best * 3 + 2]),
        normal: new THREE.Vector3(s.n[best * 3], s.n[best * 3 + 1], s.n[best * 3 + 2]),
      };
    }
    return { origin: center, normal: new THREE.Vector3(0, 0, 1) };
  }

  private startPaint(
    id: PartId,
    kind: ChangeKind,
    old: THREE.MeshPhysicalMaterial,
    style: PartStyle,
    delay: number,
    now: number,
    opts: SetPartsOptions,
  ): { tr: PaintTransition; origin: THREE.Vector3; normal: THREE.Vector3 } | null {
    const tint = new THREE.Color(style.pattern?.colors[0] ?? style.color);
    let pp = this.paints.get(id);
    const spreading = pp ? pp.layers.filter((l) => l.overlay) : [];
    if (pp && spreading.length && (now - pp.lastChange < LIVE_CHANGE_MS || spreading.length >= MAX_LAYERS)) {
      // ピッカーのドラッグなど、塗っている最中に続けて変わった: 一番下の層だけ差し替えて続ける
      pp.lastChange = now;
      disposeMaterial(old);
      spreading[spreading.length - 1].uniforms.uSfTint.value.copy(tint);
      this.spray?.recolor(id, (style.pattern?.colors ?? [style.color]).map((c) => new THREE.Color(c)));
      return null;
    }
    if (!pp) {
      pp = { layers: [], lastChange: now, dry: null };
      this.paints.set(id, pp);
    }
    pp.lastChange = now;
    const o =
      opts.origin && opts.origin.part === id
        ? { origin: new THREE.Vector3(...opts.origin.position), normal: new THREE.Vector3(...opts.origin.normal).normalize() }
        : this.defaultOrigin(id, opts.eye);
    const geo = this.meshes[id].geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cover = coverRadius(bb.min.toArray() as Vec3, bb.max.toArray() as Vec3, o.origin.toArray() as Vec3);
    const uniforms = makePaintOverlay(old);
    uniforms.uSfOrigin.value.copy(o.origin);
    if (kind === 'paint') {
      uniforms.uSfTint.value.copy(tint);
      uniforms.uSfTintAmt.value = 0.55;
      uniforms.uSfSpeckle.value = SPECKLE_BAND;
    } else {
      uniforms.uSfGlowAmt.value = 1.1;
    }
    const overlay = new THREE.Mesh(geo, old);
    overlay.name = 'paint-overlay:' + id;
    overlay.raycast = () => {};
    this.root.add(overlay);
    const tr: PaintTransition = { kind, overlay, uniforms, start: now, delay, duration: paintDuration(cover, kind), cover };
    pp.layers.push(tr);
    this.restackLayers(pp);
    if (kind === 'paint') pp.dry = { start: now + delay * 1000, duration: tr.duration };
    return { tr, ...o };
  }

  /** 古い層ほど手前に描く（新しい層は古い層が消えたところから見える） */
  private restackLayers(pp: PartPaint) {
    const live = pp.layers.filter((l) => l.overlay);
    live.forEach((l, i) => {
      const m = l.overlay!.material as THREE.Material;
      const rank = live.length - i; // 一番新しい層 = 1
      m.polygonOffsetFactor = -rank;
      m.polygonOffsetUnits = -rank;
    });
  }

  private cancelPaint(id: PartId) {
    const pp = this.paints.get(id);
    if (!pp) return;
    this.paints.delete(id);
    for (const l of pp.layers) {
      if (!l.overlay) continue;
      this.root.remove(l.overlay);
      disposeMaterial(l.overlay.material as THREE.Material);
    }
    const mat = this.meshes[id].material as THREE.MeshPhysicalMaterial;
    const style = this.styles?.[id];
    if (style) {
      const surf = surfaceOf(style);
      mat.roughness = surf.roughness;
      mat.envMapIntensity = surf.envMapIntensity;
    }
  }

  /** スプレー缶の段取り。1 パーツならその塗り終わりまで、複数なら順に渡り歩く */
  private queueSpray(started: { part: PartId; tr: PaintTransition; origin: THREE.Vector3; normal: THREE.Vector3 }[], parts: Record<PartId, PartStyle>, now: number) {
    const jobs = started.filter((s) => s.tr.kind === 'paint');
    if (!jobs.length) return;
    if (!this.spray) {
      this.spray = new SprayRig(new THREE.Vector3(...this.def.target));
      this.fxGroup.add(this.spray.group);
    }
    jobs.forEach((s, i) => {
      const from = now + s.tr.delay * 1000;
      const next = jobs[i + 1];
      const to = next ? now + next.tr.delay * 1000 : from + Math.min(s.tr.duration * 0.9, jobs.length > 1 ? 0.5 : 9) * 1000;
      const samples = this.getSamples(s.part);
      const dist = new Float32Array(samples.count);
      for (let k = 0; k < samples.count; k++) {
        dist[k] = Math.hypot(samples.p[k * 3] - s.origin.x, samples.p[k * 3 + 1] - s.origin.y, samples.p[k * 3 + 2] - s.origin.z);
      }
      const style = parts[s.part];
      const colors = (style.pattern?.colors ?? [style.color]).map((c) => new THREE.Color(c));
      this.spray!.add({ part: s.part, colors, from, to, spreadStart: from, duration: s.tr.duration, cover: s.tr.cover, origin: s.origin, normal: s.normal, samples, dist });
    });
  }

  // ------------------------------------------------------------------ デカール

  /** デカールを差分更新。テクスチャ読み込みを待つ Promise を返す。animate なら新しいデカールは貼る演出、消えたものははがす演出 */
  setDecals(decals: Decal[], selectedId: string | null, opts: { animate?: boolean } = {}): Promise<void> {
    const animate = !!opts.animate && this.knownDecals !== null;
    const wanted = new Set(decals.map((d) => d.id));
    this.wantedKeys.clear();
    this.selectedDecal = selectedId;
    for (const [id, entry] of this.decalMeshes) {
      if (!wanted.has(id)) {
        if (animate && entry.sticker) this.startSticker('remove', entry);
        else this.removeDecalMesh(entry.mesh);
        this.decalMeshes.delete(id);
      }
    }
    for (const id of this.pendingApply) if (!wanted.has(id)) this.pendingApply.delete(id);
    if (animate) for (const d of decals) if (!this.knownDecals!.has(d.id)) this.pendingApply.add(d.id);
    this.knownDecals = wanted;

    const tasks: Promise<void>[] = [];
    for (const d of decals) {
      const key = JSON.stringify(d);
      this.wantedKeys.set(d.id, key);
      const cur = this.decalMeshes.get(d.id);
      if (cur && cur.key === key) {
        this.applyDecalSelection(cur.mesh, d.id === selectedId);
        continue;
      }
      tasks.push(
        getDecalTexture(d).then(({ texture, aspect }) => {
          if (this.wantedKeys.get(d.id) !== key) return; // もっと新しい更新が来ている
          const built = this.buildDecalMesh(d, texture, aspect);
          const prev = this.decalMeshes.get(d.id);
          if (prev) this.removeDecalMesh(prev.mesh);
          if (!built) {
            this.decalMeshes.delete(d.id);
            return;
          }
          this.applyDecalSelection(built.mesh, d.id === this.selectedDecal);
          this.decalGroup.add(built.mesh);
          const entry: DecalEntry = { key, mesh: built.mesh, aspect, sticker: built.sticker };
          this.decalMeshes.set(d.id, entry);
          if (this.pendingApply.has(d.id)) {
            this.pendingApply.delete(d.id);
            if (entry.sticker) this.startSticker('apply', entry);
          }
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

  /** 貼ったデカールのテクスチャの縦横比（3D ハンドルの大きさに使う） */
  decalAspect(id: string): number | null {
    return this.decalMeshes.get(id)?.aspect ?? null;
  }

  /** そのデカールを貼っている途中か（終わるまで 3D ハンドルを出さない） */
  decalBusy(id: string): boolean {
    const mesh = this.decalMeshes.get(id)?.mesh;
    return this.pendingApply.has(id) || (!!mesh && this.stickers.some((a) => a.mesh === mesh && a.mode === 'apply'));
  }

  private projectDecal(d: Pick<Decal, 'part' | 'position' | 'normal' | 'rotation' | 'scale'>, aspect: number): { geo: THREE.BufferGeometry; basis: DecalBasis; w: number; h: number } | null {
    const target = this.meshes[d.part];
    if (!target) return null;
    const basis = decalBasis(d.normal, d.rotation);
    const [w, h] = decalSize(d.scale, aspect);
    const depth = Math.min(0.45, Math.max(0.18, Math.max(w, h) * 0.6));
    // パーツのジオメトリをモデル座標のまま投影する（matrixWorld = 単位行列のプロキシ）
    const proxy = new THREE.Mesh(target.geometry);
    proxy.updateMatrixWorld(true);
    try {
      const geo = new DecalGeometry(proxy, new THREE.Vector3(...d.position), new THREE.Euler().setFromQuaternion(basis.q), new THREE.Vector3(w, h, depth));
      return { geo, basis, w, h };
    } catch {
      return null;
    }
  }

  private buildDecalMesh(d: Decal, texture: THREE.Texture, aspect: number): { mesh: THREE.Mesh; sticker: StickerUniforms | null } | null {
    const proj = this.projectDecal(d, aspect);
    if (!proj) return null;
    const { geo, basis, w } = proj;
    if (geo.getAttribute('position').count === 0) {
      geo.dispose();
      // 投影先に面が無いときも位置が分かるよう空メッシュで保持
      return { mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false })), sticker: null };
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
    const sticker = patchSticker(mat);
    sticker.uSfW.value = w;
    sticker.uSfT.value.copy(basis.x);
    sticker.uSfN.value.copy(basis.n);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10 + d.z;
    mesh.name = 'decal:' + d.id;
    mesh.userData.decalId = d.id;
    mesh.userData.center = new THREE.Vector3(...d.position);
    mesh.userData.basis = basis;
    mesh.userData.size = [proj.w, proj.h];
    return { mesh, sticker };
  }

  private applyDecalSelection(mesh: THREE.Mesh, selected: boolean) {
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m.emissive) return;
    m.emissive.copy(selected ? ACCENT : BLACK);
    m.emissiveIntensity = selected ? 0.16 : 1;
  }

  private startSticker(mode: 'apply' | 'remove', entry: DecalEntry) {
    if (!entry.sticker) return;
    const center = entry.mesh.userData.center as THREE.Vector3;
    const basis = entry.mesh.userData.basis as DecalBasis;
    const [w, h] = entry.mesh.userData.size as [number, number];
    let tool: THREE.Group | null = null;
    if (mode === 'remove') this.applyDecalSelection(entry.mesh, false);
    if (mode === 'apply') {
      tool = buildSqueegee();
      tool.visible = false;
      this.fxGroup.add(tool);
    }
    const anim: StickerAnim = { mode, mesh: entry.mesh, u: entry.sticker, start: performance.now(), tool, center, basis, w, h };
    this.stickers.push(anim);
    this.tickSticker(anim, anim.start);
  }

  /** 1 本のステッカー演出を進める。終わったら true */
  private tickSticker(a: StickerAnim, now: number): boolean {
    const t = (now - a.start) / 1000;
    const dur = a.mode === 'apply' ? APPLY_DURATION : REMOVE_DURATION;
    const pose = a.mode === 'apply' ? applyPose(t) : removePose(t);
    const done = t >= dur;
    const mat = a.mesh.material as THREE.MeshStandardMaterial;
    if (done) {
      a.u.uSfPeel.value = 2;
      a.u.uSfLift.value = 0;
      a.u.uSfFlash.value = 0;
      mat.opacity = 1;
    } else {
      a.u.uSfPeel.value = pose.peel;
      a.u.uSfAngle.value = pose.angle;
      a.u.uSfLift.value = pose.lift;
      a.u.uSfFlash.value = pose.flash;
      mat.opacity = pose.opacity;
    }
    if (a.tool) {
      const k = done ? 0 : 1 - (1 - pose.tool) ** 2;
      a.tool.visible = k > 0.01;
      if (a.tool.visible) {
        const { x: T, y: B, n: N } = a.basis;
        // 刃先は押し付けの境目。上側は押し付け済みの側へ傾ける（浮いている部分に刺さらない向き）
        const z = N.clone().multiplyScalar(Math.cos(SQUEEGEE_TILT)).addScaledVector(T, -Math.sin(SQUEEGEE_TILT));
        const x = new THREE.Vector3().crossVectors(B, z).normalize();
        a.tool.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, B, z));
        a.tool.position
          .copy(a.center)
          .addScaledVector(T, (Math.min(1, pose.peel) - 0.5) * a.w)
          .addScaledVector(N, 0.012 + pose.lift + (1 - k) * 0.25);
        a.tool.scale.set(k, a.h * 1.2 * k + 0.0001, k);
      }
    }
    return done;
  }

  private finishSticker(a: StickerAnim) {
    if (a.tool) {
      this.fxGroup.remove(a.tool);
      disposeGroup(a.tool);
      a.tool = null;
    }
    if (a.mode === 'remove') this.removeDecalMesh(a.mesh, true);
  }

  private removeDecalMesh(mesh: THREE.Mesh, fromAnim = false) {
    if (!fromAnim) {
      // 貼っている途中に作り直された / 消された: 演出を打ち切る
      const i = this.stickers.findIndex((a) => a.mesh === mesh);
      if (i >= 0) {
        const [a] = this.stickers.splice(i, 1);
        if (a.tool) {
          this.fxGroup.remove(a.tool);
          disposeGroup(a.tool);
        }
      }
    }
    this.decalGroup.remove(mesh);
    mesh.geometry.dispose();
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.map && m.map.repeat.x === -1) m.map.dispose();
    m.dispose();
  }

  // ------------------------------------------------------------------ 貼り付け前のプレビュー

  /** 貼り付け待ちのとき、カーソル（タップ）位置に半透明のステッカーを表示する */
  setGhost(p: DecalPreview | null) {
    const seq = ++this.ghostSeq;
    if (!p) {
      this.clearGhost();
      this.onChange();
      return;
    }
    void getDecalTexture(p).then(({ texture, aspect }) => {
      if (seq !== this.ghostSeq) return;
      const proj = this.projectDecal(p, aspect);
      this.clearGhost();
      if (!proj || proj.geo.getAttribute('position').count === 0) {
        proj?.geo.dispose();
        this.onChange();
        return;
      }
      let map = texture;
      if (p.flip) {
        map = texture.clone();
        map.repeat.x = -1;
        map.offset.x = 1;
      }
      const mat = new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -60,
        roughness: 0.5,
        emissive: ACCENT,
        emissiveIntensity: 0.12,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(proj.geo, mat);
      mesh.name = 'decal-ghost';
      mesh.renderOrder = 200;
      mesh.raycast = () => {};
      this.ghostMesh = mesh;
      this.fxGroup.add(mesh);
      this.onChange();
    });
  }

  private clearGhost() {
    if (!this.ghostMesh) return;
    this.fxGroup.remove(this.ghostMesh);
    this.ghostMesh.geometry.dispose();
    const m = this.ghostMesh.material as THREE.MeshStandardMaterial;
    if (m.map && m.map.repeat.x === -1) m.map.dispose();
    m.dispose();
    this.ghostMesh = null;
  }

  // ------------------------------------------------------------------ 毎フレーム

  /** 演出を進める。まだ動いているものがあれば true（呼び出し側は次のフレームを要求する） */
  tick(now: number, camera: THREE.Camera): boolean {
    let active = false;
    for (const [id, pp] of this.paints) {
      for (const tr of pp.layers) {
        if (!tr.overlay) continue;
        const t = (now - tr.start) / 1000 - tr.delay;
        tr.uniforms.uSfRadius.value = t < 0 ? -1 : paintRadius(t, tr.duration, tr.cover);
        if (t >= tr.duration) {
          this.root.remove(tr.overlay);
          disposeMaterial(tr.overlay.material as THREE.Material);
          tr.overlay = null;
        }
      }
      pp.layers = pp.layers.filter((l) => l.overlay);
      const style = this.styles?.[id];
      if (pp.dry && style) {
        // 塗りたては艶があり、乾くと素材本来の粗さに戻る
        const mat = this.meshes[id].material as THREE.MeshPhysicalMaterial;
        const spec = surfaceOf(style);
        const t = (now - pp.dry.start) / 1000;
        const dry = t < 0 ? 0 : dryFactor(t, pp.dry.duration);
        const wet = Math.min(WET_ROUGHNESS, spec.roughness);
        mat.roughness = wet + (spec.roughness - wet) * dry;
        mat.envMapIntensity = spec.envMapIntensity + WET_ENV_BOOST * (1 - dry);
        if (dry >= 1) pp.dry = null;
      }
      if (!pp.layers.length && !pp.dry) {
        this.paints.delete(id);
        continue;
      }
      active = true;
    }
    if (this.spray && this.spray.tick(now, camera)) active = true;
    if (this.stickers.length) {
      const left: StickerAnim[] = [];
      for (const a of this.stickers) {
        if (this.tickSticker(a, now)) this.finishSticker(a);
        else left.push(a);
      }
      this.stickers = left;
      active = true;
    }
    return active;
  }

  /** E2E・デバッグ用の状態 */
  fxStats(): FxStats {
    let overlays = 0;
    for (const pp of this.paints.values()) overlays += pp.layers.filter((l) => l.overlay).length;
    return {
      paints: this.paints.size,
      overlays,
      stickers: this.stickers.length,
      can: !!this.spray?.visible,
      particles: this.spray?.particleCount ?? 0,
      ghost: !!this.ghostMesh,
    };
  }

  dispose() {
    for (const id of [...this.paints.keys()]) this.cancelPaint(id);
    for (const a of this.stickers) this.finishSticker(a);
    this.stickers = [];
    for (const id of PART_IDS) disposeMaterial(this.meshes[id].material as THREE.Material);
    for (const { mesh } of this.decalMeshes.values()) this.removeDecalMesh(mesh);
    this.decalMeshes.clear();
    this.clearGhost();
    this.spray?.dispose();
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
