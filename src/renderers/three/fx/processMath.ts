/**
 * 「制作過程」の演出で使う計算（DOM / WebGL に依存しない純粋関数。単体テスト対象）。
 *  - 塗り: 色が塗り広がる半径・時間・乾くまでの艶
 *  - ステッカー: 端から押し付けて貼る / はがすときの反り（シェーダーと同じ式）
 *  - 3D ハンドル: デカールの向き・回転・拡大のドラッグ計算
 */
import * as THREE from 'three';
import type { PartId, PartStyle, Vec3 } from '../../../models/types';
import { PART_IDS } from '../../../models/types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (k: number) => 1 - (1 - k) ** 2;
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

// ---------------------------------------------------------------- 塗り

export type ChangeKind = 'paint' | 'material';

/** パーツの見た目の変化を分類する。素材・ツヤが変われば material、色・柄だけなら paint、同じなら null */
export function classifyChange(prev: PartStyle | undefined, next: PartStyle): ChangeKind | null {
  if (!prev) return null;
  if (prev.material !== next.material || (prev.finish ?? 0) !== (next.finish ?? 0)) return 'material';
  if (prev.color !== next.color) return 'paint';
  if (JSON.stringify(prev.pattern ?? null) !== JSON.stringify(next.pattern ?? null)) return 'paint';
  return null;
}

/** 変化したパーツを PART_IDS の順に返す */
export function changedParts(prev: Record<PartId, PartStyle> | null, next: Record<PartId, PartStyle>): { part: PartId; kind: ChangeKind }[] {
  if (!prev) return [];
  const out: { part: PartId; kind: ChangeKind }[] = [];
  for (const part of PART_IDS) {
    const kind = classifyChange(prev[part], next[part]);
    if (kind) out.push({ part, kind });
  }
  return out;
}

/** 塗りの縁のギザギザ（ノイズ）の振れ幅と、縁の先に飛ぶしぶきの帯の幅（モデル単位） */
export const EDGE_NOISE = 0.14;
export const SPECKLE_BAND = 0.09;

/** バウンディングボックスの 8 隅のうち origin から一番遠い距離 = パーツ全体を覆う半径 */
export function coverRadius(min: Vec3, max: Vec3, origin: Vec3): number {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? max[0] : min[0];
    const y = i & 2 ? max[1] : min[1];
    const z = i & 4 ? max[2] : min[2];
    r = Math.max(r, Math.hypot(x - origin[0], y - origin[1], z - origin[2]));
  }
  return r;
}

/** 塗り広げにかける時間（秒）。大きいパーツほど長いが、待たされない長さに収める */
export function paintDuration(cover: number, kind: ChangeKind = 'paint'): number {
  const d = clamp(0.6 + cover * 0.45, 0.8, 1.9);
  return kind === 'material' ? d * 0.8 : d;
}

/** t 秒後の塗り広がりの半径。少しずつ減速しながら広がり、終わりには縁のノイズとしぶきまで含めて必ず全体を覆う */
export function paintRadius(t: number, duration: number, cover: number): number {
  const k = clamp(t / duration, 0, 1);
  return (cover + EDGE_NOISE + SPECKLE_BAND + 0.02) * k * (1.5 - 0.5 * k);
}

/** 複数パーツを一度に塗るとき（ランダム配色・Undo）は少しずつずらして始める */
export function staggerDelays(count: number, step = 0.09): number[] {
  return Array.from({ length: count }, (_, i) => i * step);
}

/** 塗りたての艶。0 = 濡れている → 1 = 乾いて素材本来の粗さ */
export function dryFactor(t: number, duration: number): number {
  return smooth(duration * 0.55, duration + 1.1, t);
}
export const WET_ROUGHNESS = 0.14;
export const WET_ENV_BOOST = 0.45;

// ---------------------------------------------------------------- ステッカー

/** 貼っている途中のステッカーが表面から反り上がる角度（ラジアン）と付け根の曲がりの半径 */
export const PEEL_ANGLE = 0.62;
export const PEEL_RADIUS = 0.05;

/**
 * 付け根（ヘラの位置）から s だけ先の点が、平らな状態からどれだけずれるか。
 * [接線方向のずれ, 法線方向のずれ] を返す。付け根は半径 R の円弧で曲がり、その先は角度 A で真っすぐ浮く。
 * GLSL（stickerFx.ts）と同じ式。
 */
export function peelOffset(s: number, angle = PEEL_ANGLE, R = PEEL_RADIUS): [number, number] {
  if (s <= 0) return [0, 0];
  const th = Math.min(s / R, angle);
  const rest = Math.max(s - R * angle, 0);
  const t = R * Math.sin(th) + Math.cos(angle) * rest;
  const n = R * (1 - Math.cos(th)) + Math.sin(angle) * rest;
  return [t - s, n];
}

export interface StickerPose {
  /** 押し付け済みの割合（0 = 左端だけ / 1 = 全部）。uv.x がこれより大きい部分が浮く */
  peel: number;
  /** 浮いている部分の角度 */
  angle: number;
  /** 全体を法線方向に浮かせる量 */
  lift: number;
  opacity: number;
  /** ヘラ（スキージー）の見え具合 0..1 */
  tool: number;
  /** 貼り終わりの発光 0..1 */
  flash: number;
}

export const APPLY_DURATION = 1.05;
export const REMOVE_DURATION = 0.6;

/** 貼り付け: 浮いた状態で近づく → ヘラで左端から押し付ける → 軽く光って完了 */
export function applyPose(t: number): StickerPose {
  const A = 0.3; // 近づく
  const B = 0.92; // 押し付け終わり
  if (t < A) {
    const k = easeOut(t / A);
    return { peel: 0, angle: 1.25 + (PEEL_ANGLE - 1.25) * k, lift: 0.24 * (1 - k), opacity: clamp(t / 0.12, 0, 1), tool: smooth(0.1, A, t), flash: 0 };
  }
  if (t < B) {
    const k = easeInOut((t - A) / (B - A));
    return { peel: k * 1.02, angle: PEEL_ANGLE, lift: 0, opacity: 1, tool: 1, flash: 0 };
  }
  const k = clamp((t - B) / (APPLY_DURATION - B), 0, 1);
  return { peel: 1.02, angle: PEEL_ANGLE, lift: 0, opacity: 1, tool: 1 - k, flash: 1 - k };
}

/** はがす: 右端からめくれて浮き上がり、消える */
export function removePose(t: number): StickerPose {
  const k = clamp(t / 0.38, 0, 1);
  const peel = 1.02 * (1 - easeInOut(k));
  const angle = PEEL_ANGLE + (1.35 - PEEL_ANGLE) * easeOut(k);
  const lift = 0.3 * smooth(0.25, REMOVE_DURATION, t);
  const opacity = 1 - smooth(0.32, REMOVE_DURATION, t);
  return { peel, angle, lift, opacity, tool: 0, flash: 0 };
}

// ---------------------------------------------------------------- デカールの向きと 3D ハンドル

export interface DecalBasis {
  /** 横（テクスチャの u 方向） */
  x: THREE.Vector3;
  /** 縦（テクスチャの v 方向） */
  y: THREE.Vector3;
  /** 投影方向（表面の外向き） */
  n: THREE.Vector3;
  q: THREE.Quaternion;
}

/** デカールの法線と回転（度）から、投影ボックスの向きを求める（SneakerView の投影と同じ） */
export function decalBasis(normal: Vec3, rotationDeg: number): DecalBasis {
  const n = new THREE.Vector3(...normal);
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  n.normalize();
  const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x0 = new THREE.Vector3().crossVectors(up, n).normalize();
  const y0 = new THREE.Vector3().crossVectors(n, x0);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x0, y0, n));
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(n, (-rotationDeg * Math.PI) / 180));
  return { x: new THREE.Vector3(1, 0, 0).applyQuaternion(q), y: new THREE.Vector3(0, 1, 0).applyQuaternion(q), n, q };
}

/** scale = 長辺の長さ。aspect = 幅 / 高さ */
export function decalSize(scale: number, aspect: number): [number, number] {
  return aspect >= 1 ? [scale, scale / aspect] : [scale * aspect, scale];
}

export const SCALE_MIN = 0.08;
export const SCALE_MAX = 1.6;

/** -180 < v <= 180 に丸める */
export function wrapDeg(v: number): number {
  let r = ((((v + 180) % 360) + 360) % 360) - 180;
  if (r === -180) r = 180;
  return r;
}

/**
 * 回転ハンドルのドラッグ。a0 / a1 は画面上でのデカール中心からの角度（ラジアン、y 下向きの画面座標）。
 * facing = 1 ならデカールの表をこちらに向けて見ている。snap（度）を渡すとその刻みにそろえる。
 */
export function dragRotation(startDeg: number, a0: number, a1: number, facing: 1 | -1, snap = 0): number {
  let d = ((a1 - a0) * 180) / Math.PI;
  d = wrapDeg(d);
  let r = wrapDeg(startDeg + facing * d);
  if (snap > 0) r = wrapDeg(Math.round(r / snap) * snap);
  return Math.round(r);
}

/** 拡大ハンドルのドラッグ。d0 / d1 は画面上でのデカール中心からの距離（px） */
export function dragScale(startScale: number, d0: number, d1: number): number {
  const k = d1 / Math.max(d0, 1);
  return Math.round(clamp(startScale * k, SCALE_MIN, SCALE_MAX) * 100) / 100;
}

/** 点 p がデカールの貼られた範囲（投影ボックスの中）にあるか */
export function insideDecal(p: Vec3, center: Vec3, basis: DecalBasis, w: number, h: number, depth = 0.2): boolean {
  const d = new THREE.Vector3(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
  return Math.abs(d.dot(basis.x)) <= w / 2 && Math.abs(d.dot(basis.y)) <= h / 2 && Math.abs(d.dot(basis.n)) <= depth;
}

/** 回転ハンドルを枠の上辺からどれだけ離すか（モデル単位） */
export const ROTATE_HANDLE_GAP = 0.13;

export interface GizmoAnchors {
  basis: DecalBasis;
  w: number;
  h: number;
  center: THREE.Vector3;
  /** 左下・右下・右上・左上 */
  corners: THREE.Vector3[];
  /** 上辺の中央（回転ハンドルの柄の根元） */
  top: THREE.Vector3;
  rotate: THREE.Vector3;
  scale: THREE.Vector3;
}

/** 選択中デカールの 3D ハンドルの位置。表面から lift だけ浮かせる */
export function gizmoAnchors(position: Vec3, normal: Vec3, rotation: number, scale: number, aspect: number, lift = 0.012): GizmoAnchors {
  const basis = decalBasis(normal, rotation);
  const [w, h] = decalSize(scale, aspect);
  const center = new THREE.Vector3(...position).addScaledVector(basis.n, lift);
  const corner = (sx: number, sy: number) => center.clone().addScaledVector(basis.x, (sx * w) / 2).addScaledVector(basis.y, (sy * h) / 2);
  const top = center.clone().addScaledVector(basis.y, h / 2);
  return {
    basis,
    w,
    h,
    center,
    corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    top,
    rotate: top.clone().addScaledVector(basis.y, ROTATE_HANDLE_GAP),
    scale: corner(1, -1),
  };
}
