/**
 * 選択中のデカールを 3D 上で直接動かすハンドル。
 *  - 枠: デカールの範囲（ライムの線）
 *  - 上の丸: ドラッグで回転（Shift で 15° 刻み）
 *  - 右下の四角: ドラッグで拡大・縮小
 *  - デカールそのもの: ドラッグで表面をなぞって移動
 * 当たり判定はキャンバスを包む要素のキャプチャ段階で行い、ハンドルを掴んだときだけカメラの回転を止める。
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Decal, PartId, Vec3 } from '../../models/types';
import type { SneakerView } from '../three/SneakerView';
import { dragRotation, dragScale, gizmoAnchors, insideDecal, type GizmoAnchors } from '../three/fx/processMath';

export interface DecalTransformPatch {
  part?: PartId;
  position?: Vec3;
  normal?: Vec3;
  rotation?: number;
  scale?: number;
}

export interface GizmoScreenPoints {
  center: { x: number; y: number };
  rotate: { x: number; y: number };
  scale: { x: number; y: number };
}

type Mode = 'rotate' | 'scale' | 'body';

interface Props {
  view: SneakerView;
  decal: Decal | null;
  /** 貼り付け待ち・移動モード・スプレー中は出さない */
  enabled: boolean;
  container: React.RefObject<HTMLDivElement>;
  controls: React.MutableRefObject<OrbitControlsImpl | null>;
  /** ドラッグが終わったときのカメラ操作の有効/無効 */
  controlsEnabled: () => boolean;
  onStart?: () => void;
  onChange?: (id: string, patch: DecalTransformPatch) => void;
  onEnd?: () => void;
  /** E2E・デバッグ用にハンドルの画面座標を返す関数を受け取る */
  debugRef?: React.MutableRefObject<(() => GizmoScreenPoints | null) | null>;
}

const ACCENT = '#C6FF00';
const round = (v: number) => Math.round(v * 10000) / 10000;

export function DecalGizmo(props: Props) {
  const { camera, gl, invalidate } = useThree();
  const latest = useRef(props);
  latest.current = props;
  const dragging = useRef(false);

  const parts = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'fx:gizmo';
    const lineMat = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.95 });
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    const frame = new THREE.Line(frameGeo, lineMat);
    const stemGeo = new THREE.BufferGeometry();
    stemGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const stem = new THREE.Line(stemGeo, lineMat);
    const rotate = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }));
    const rotateRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.22, 8, 28), new THREE.MeshBasicMaterial({ color: '#0E0E10', depthTest: false, transparent: true, opacity: 0.85 }));
    const scale = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial({ color: '#F2F2EE', depthTest: false, transparent: true }));
    const scaleRim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.1, 0.4), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }));
    for (const o of [frame, stem, rotate, rotateRing, scale, scaleRim]) {
      o.renderOrder = 300;
      o.raycast = () => {};
      o.frustumCulled = false;
    }
    rotate.renderOrder = scale.renderOrder = 302;
    group.add(frame, stem, rotateRing, rotate, scaleRim, scale);
    group.visible = false;
    return { group, frame, stem, rotate, rotateRing, scale, scaleRim };
  }, []);

  useEffect(
    () => () => {
      parts.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    },
    [parts],
  );

  const anchors = (): GizmoAnchors | null => {
    const { decal, view, enabled } = latest.current;
    if (!decal || !enabled || view.decalBusy(decal.id)) return null;
    const aspect = view.decalAspect(decal.id);
    if (!aspect) return null;
    return gizmoAnchors(decal.position, decal.normal, decal.rotation, decal.scale, aspect);
  };

  const screenOf = (v: THREE.Vector3) => {
    const r = gl.domElement.getBoundingClientRect();
    const p = v.clone().project(camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  };

  /** 画面座標の点から、靴ひも以外のパーツへ当てる */
  const castParts = (cx: number, cy: number) => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const view = latest.current.view;
    view.root.updateMatrixWorld(true);
    const targets = Object.values(view.meshes).filter((m) => m.name !== 'laces');
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit || !hit.face) return null;
    const local = view.root.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone();
    if (n.dot(ray.ray.direction) > 0) n.negate();
    return { part: hit.object.userData.partId as PartId, position: [round(local.x), round(local.y), round(local.z)] as Vec3, normal: [round(n.x), round(n.y), round(n.z)] as Vec3 };
  };

  const hitTest = (cx: number, cy: number, touch: boolean): Mode | null => {
    const a = anchors();
    const decal = latest.current.decal;
    if (!a || !decal) return null;
    const R = touch ? 28 : 16;
    const rot = screenOf(a.rotate);
    if (Math.hypot(cx - rot.x, cy - rot.y) < R) return 'rotate';
    const sc = screenOf(a.scale);
    if (Math.hypot(cx - sc.x, cy - sc.y) < R) return 'scale';
    const pts = a.corners.map(screenOf);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    if (cx < Math.min(...xs) - 6 || cx > Math.max(...xs) + 6 || cy < Math.min(...ys) - 6 || cy > Math.max(...ys) + 6) return null;
    const hit = castParts(cx, cy);
    if (hit && insideDecal(hit.position, decal.position, a.basis, a.w, a.h, 0.3)) return 'body';
    return null;
  };

  // ---- ドラッグ（ネイティブのポインターイベント） ----
  useEffect(() => {
    const el = props.container.current;
    if (!el) return;
    const pointers = new Set<number>();
    let drag: {
      mode: Mode;
      id: string;
      pointerId: number;
      x0: number;
      y0: number;
      cx: number;
      cy: number;
      a0: number;
      d0: number;
      rot0: number;
      scale0: number;
      facing: 1 | -1;
      moved: boolean;
    } | null = null;
    let suppressClick = false;
    let hoverRaf = 0;

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const c = latest.current.controls.current;
      if (c) c.enabled = latest.current.controlsEnabled();
      if (drag) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 400);
        latest.current.onEnd?.();
      }
      drag = null;
      dragging.current = false;
    };

    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        // 2 本指（ピンチ）になったらハンドル操作はやめてカメラに任せる
        if (drag) finish();
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const mode = hitTest(e.clientX, e.clientY, e.pointerType !== 'mouse');
      const decal = latest.current.decal;
      const a = anchors();
      if (!mode || !decal || !a) return;
      const c = latest.current.controls.current;
      if (c) c.enabled = false;
      const cs = screenOf(a.center);
      const toEye = camera.position.clone().sub(a.center);
      drag = {
        mode,
        id: decal.id,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        cx: cs.x,
        cy: cs.y,
        a0: Math.atan2(e.clientY - cs.y, e.clientX - cs.x),
        d0: Math.hypot(e.clientX - cs.x, e.clientY - cs.y),
        rot0: decal.rotation,
        scale0: decal.scale,
        facing: toEye.dot(a.basis.n) >= 0 ? 1 : -1,
        moved: false,
      };
      dragging.current = true;
      latest.current.onStart?.();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;
      drag.moved = true;
      const cb = latest.current.onChange;
      if (!cb) return;
      if (drag.mode === 'rotate') {
        const a1 = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        cb(drag.id, { rotation: dragRotation(drag.rot0, drag.a0, a1, drag.facing, e.shiftKey ? 15 : 0) });
      } else if (drag.mode === 'scale') {
        cb(drag.id, { scale: dragScale(drag.scale0, drag.d0, Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy)) });
      } else {
        // 掴んだ位置とデカール中心の画面上のずれを保ったまま、表面をなぞる
        const hit = castParts(e.clientX + (drag.cx - drag.x0), e.clientY + (drag.cy - drag.y0));
        if (hit) cb(drag.id, hit);
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (!drag || e.pointerId !== drag.pointerId) return;
      finish();
    };

    const onAnyUp = (e: PointerEvent) => pointers.delete(e.pointerId);

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    const onHover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || drag) return;
      cancelAnimationFrame(hoverRaf);
      const { clientX, clientY } = e;
      hoverRaf = requestAnimationFrame(() => {
        const mode = latest.current.enabled ? hitTest(clientX, clientY, false) : null;
        el.style.cursor = mode === 'rotate' ? 'grab' : mode === 'scale' ? 'nwse-resize' : mode === 'body' ? 'move' : '';
      });
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('click', onClick, true);
    el.addEventListener('pointermove', onHover);
    window.addEventListener('pointerup', onAnyUp);
    window.addEventListener('pointercancel', onAnyUp);
    return () => {
      finish();
      cancelAnimationFrame(hoverRaf);
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('pointermove', onHover);
      window.removeEventListener('pointerup', onAnyUp);
      window.removeEventListener('pointercancel', onAnyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.container, camera, gl]);

  // ---- E2E 用 ----
  useEffect(() => {
    const ref = props.debugRef;
    if (!ref) return;
    ref.current = () => {
      const a = anchors();
      if (!a) return null;
      return { center: screenOf(a.center), rotate: screenOf(a.rotate), scale: screenOf(a.scale) };
    };
    return () => {
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.debugRef, camera, gl]);

  // 選択・表示の切り替えで描き直す
  useEffect(() => invalidate(), [props.decal, props.enabled, invalidate]);

  // ---- 見た目の更新（描画のたび） ----
  useFrame(() => {
    const a = anchors();
    parts.group.visible = !!a;
    if (!a) return;
    const f = parts.frame.geometry.getAttribute('position') as THREE.BufferAttribute;
    [...a.corners, a.corners[0]].forEach((p, i) => f.setXYZ(i, p.x, p.y, p.z));
    f.needsUpdate = true;
    const s = parts.stem.geometry.getAttribute('position') as THREE.BufferAttribute;
    s.setXYZ(0, a.top.x, a.top.y, a.top.z);
    s.setXYZ(1, a.rotate.x, a.rotate.y, a.rotate.z);
    s.needsUpdate = true;
    // ハンドルは画面上でほぼ同じ大きさに見えるよう、カメラからの距離で大きさを変える
    const k = (p: THREE.Vector3) => camera.position.distanceTo(p) * 0.0068;
    parts.rotate.position.copy(a.rotate);
    parts.rotate.scale.setScalar(k(a.rotate));
    parts.rotateRing.position.copy(a.rotate);
    parts.rotateRing.scale.setScalar(k(a.rotate));
    parts.rotateRing.quaternion.copy(camera.quaternion);
    parts.scale.position.copy(a.scale);
    parts.scale.scale.setScalar(k(a.scale));
    parts.scale.quaternion.copy(a.basis.q);
    parts.scaleRim.position.copy(a.scale);
    parts.scaleRim.scale.setScalar(k(a.scale));
    parts.scaleRim.quaternion.copy(a.basis.q);
    const op = dragging.current ? 1 : 0.95;
    (parts.frame.material as THREE.LineBasicMaterial).opacity = op;
  });

  return <primitive object={parts.group} />;
}
