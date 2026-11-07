/**
 * @react-three/fiber + drei の 3D ビュー。
 * 実際の Three.js オブジェクト生成は SneakerView（レンダラー層）に任せ、ここは操作と表示だけを担当する。
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraState, Decal, PartId, SneakerDesign, Vec3 } from '../../models/types';
import { getBaseModel, modelOf } from '../../models';
import { getGeometries, type BaseModelDef, type ViewPreset } from '../../models/baseModel';
import { SneakerView, addStageLights, type DecalPreview, type FxStats, type PaintOrigin } from '../three/SneakerView';
import { DecalGizmo, type DecalTransformPatch, type GizmoScreenPoints } from './DecalGizmo';

/** 貼り付け待ちのデカール（位置はタップで決まる） */
export type PlacingDraft = Omit<DecalPreview, 'part' | 'position' | 'normal'>;

export interface PickInfo {
  part: PartId | null;
  decalId: string | null;
  position: Vec3;
  normal: Vec3;
}

export interface SneakerCanvasProps {
  design: SneakerDesign;
  highlightPart?: PartId | null;
  selectedDecalId?: string | null;
  initialCamera?: CameraState | null;
  viewRequest?: { preset: ViewPreset; nonce: number } | null;
  nudgeRequest?: { id: string; dx: number; dy: number; nonce: number } | null;
  /** タップ（ドラッグでない）したとき */
  onPick?: (p: PickInfo) => void;
  /** デカール貼り付け待ち（靴ひもとデカールを当たり判定から外す） */
  placing?: boolean;
  /** dragMode が true の間、1 本指ドラッグはモデル表面をなぞる（デカール移動） */
  dragMode?: boolean;
  onDrag?: (p: PickInfo) => void;
  onDragEnd?: () => void;
  onNudged?: (id: string, p: PickInfo) => void;
  onCameraChange?: (c: CameraState) => void;
  className?: string;
  /** 着色・貼り付けの過程を 3D で見せる（エディタだけ） */
  processFx?: boolean;
  /** 最後にタップした位置（塗りの起点） */
  paintOrigin?: PaintOrigin | null;
  /** 貼り付け待ちのデカール。カーソル位置に半透明で表示する */
  placingDraft?: PlacingDraft | null;
  /** スプレーモード中（3D ハンドルを出さない） */
  spray?: boolean;
  /** 3D ハンドルで選択中のデカールを動かした */
  onDecalTransformStart?: () => void;
  onDecalTransform?: (id: string, patch: DecalTransformPatch) => void;
  onDecalTransformEnd?: () => void;
}

const tmpV = new THREE.Vector3();

function toPick(e: ThreeEvent<PointerEvent | MouseEvent>, root: THREE.Object3D, skipDecals: boolean, skipLaces = false): PickInfo | null {
  // デカールは表面とほぼ同じ距離にあるので、すぐ近くにデカールがあればそちらを優先する
  let hits = e.intersections;
  if (!skipDecals) {
    const first = hits.find((h) => h.object.userData.partId || h.object.userData.decalId);
    const decalHit = first && hits.find((h) => h.object.userData.decalId && h.distance <= first.distance + 0.03);
    if (decalHit) hits = [decalHit, ...hits];
  }
  for (const hit of hits) {
    const o = hit.object;
    const decalId = o.userData.decalId as string | undefined;
    const part = o.userData.partId as PartId | undefined;
    if (!part && !decalId) continue;
    if (skipDecals && decalId) continue;
    // 靴ひもにはデカールを貼らない（その奥の面を使う）
    if (skipLaces && part === 'laces') continue;
    if (!hit.face) continue;
    const local = root.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone();
    // DoubleSide のパーツを内側から当てた場合は法線を反転
    const dirLocal = e.ray.direction.clone().transformDirection(new THREE.Matrix4().copy(root.matrixWorld).invert());
    if (n.dot(dirLocal) > 0) n.negate();
    return {
      part: part ?? null,
      decalId: decalId ?? null,
      position: [round(local.x), round(local.y), round(local.z)],
      normal: [round(n.x), round(n.y), round(n.z)],
    };
  }
  return null;
}
const round = (v: number) => Math.round(v * 10000) / 10000;

function Studio() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const lights = addStageLights(scene);
    invalidate();
    return () => {
      scene.environment = null;
      for (const l of lights) scene.remove(l);
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/**
 * FPS 計測用: 描画フレーム数を数える（?fps=1 で表示、E2E でも参照）。
 * window.__sfSpin = true の間は、ドラッグ回転と同じようにカメラを毎フレーム回し続ける（性能テスト用）。
 */
function FrameCounter() {
  const { camera, invalidate, controls } = useThree();
  useEffect(() => {
    (window as unknown as { __sfInvalidate?: () => void }).__sfInvalidate = invalidate;
  }, [invalidate]);
  useFrame((_, dt) => {
    const w = window as unknown as { __sfFrames?: number; __sfSpin?: boolean };
    w.__sfFrames = (w.__sfFrames ?? 0) + 1;
    if (w.__sfSpin) {
      const c = controls as unknown as OrbitControlsImpl | null;
      const target = c?.target ?? new THREE.Vector3(0, 1, 0);
      tmpV.copy(camera.position).sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 1.5);
      camera.position.copy(target).add(tmpV);
      camera.lookAt(target);
      invalidate();
    }
  });
  return null;
}

interface FxDebug {
  stats: () => FxStats;
  handles: () => GizmoScreenPoints | null;
  view: SneakerView;
}

type SceneProps = SneakerCanvasProps & {
  controls: React.MutableRefObject<OrbitControlsImpl | null>;
  container: React.RefObject<HTMLDivElement>;
};

/** 3D シーン: 作品のビュー（SneakerView）と、選択中デカールのハンドル */
function Scene(props: SceneProps) {
  const { invalidate } = useThree();
  // 形の選択が変わると別のジオメトリになるので、ビューごと作り直す
  const def = modelOf(props.design);
  const view = useMemo(() => new SneakerView(def, () => invalidate()), [def, invalidate]);
  useEffect(() => () => view.dispose(), [view]);
  const gizmoDebug = useRef<(() => GizmoScreenPoints | null) | null>(null);
  const selected = props.design.decals.find((d) => d.id === props.selectedDecalId) ?? null;

  // E2E・デバッグ用（外部通信なし）
  useEffect(() => {
    if (!props.processFx) return;
    const w = window as unknown as { __sfFx?: FxDebug };
    const api: FxDebug = { stats: () => view.fxStats(), handles: () => gizmoDebug.current?.() ?? null, view };
    w.__sfFx = api;
    return () => {
      if (w.__sfFx === api) delete w.__sfFx;
    };
  }, [view, props.processFx]);

  return (
    <>
      <Model {...props} view={view} />
      {props.processFx && (
        <DecalGizmo
          view={view}
          decal={selected}
          enabled={!props.placing && !props.dragMode && !props.spray}
          container={props.container}
          controls={props.controls}
          controlsEnabled={() => !props.dragMode}
          onStart={props.onDecalTransformStart}
          onChange={props.onDecalTransform}
          onEnd={props.onDecalTransformEnd}
          debugRef={gizmoDebug}
        />
      )}
    </>
  );
}

function Model(props: SceneProps & { view: SneakerView }) {
  const { invalidate, camera, raycaster } = useThree();
  const view = props.view;
  const dragging = useRef(false);
  const originRef = useRef(props.paintOrigin ?? null);
  originRef.current = props.paintOrigin ?? null;
  const partsDesign = useRef<string | null>(null);
  const decalsDesign = useRef<string | null>(null);

  useEffect(() => {
    // 別の作品を開いたときは演出なしでそのまま表示する
    const same = partsDesign.current === props.design.id;
    partsDesign.current = props.design.id;
    view.setParts(props.design.parts, props.highlightPart ?? null, {
      animate: !!props.processFx && same,
      origin: originRef.current,
      eye: camera.position,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, props.design.parts, props.highlightPart]);
  useEffect(() => {
    const same = decalsDesign.current === props.design.id;
    decalsDesign.current = props.design.id;
    void view.setDecals(props.design.decals, props.selectedDecalId ?? null, { animate: !!props.processFx && same });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, props.design.decals, props.selectedDecalId]);

  // 演出（塗り広げ・スプレー缶・ステッカー）を進める。動いている間だけ次のフレームを要求する
  useFrame(() => {
    if (view.tick(performance.now(), camera)) invalidate();
  });

  // ---- 貼り付け待ちのプレビュー（ゴースト） ----
  const draft = props.placingDraft ?? null;
  const ghost = useRef<{ pick: PickInfo | null; dirty: boolean }>({ pick: null, dirty: false });
  const draftKey = draft ? JSON.stringify(draft) : '';
  useEffect(() => {
    if (!draft || !props.processFx) {
      view.setGhost(null);
      ghost.current = { pick: null, dirty: false };
      return;
    }
    // まずは画面の中央付近に見えている面へ置いて大きさを見せる（タッチ端末ではホバーが無いため）
    raycaster.setFromCamera(new THREE.Vector2(0, -0.05), camera);
    view.root.updateMatrixWorld(true);
    const targets = Object.values(view.meshes).filter((m) => m.name !== 'laces');
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit && hit.face) {
      const local = view.root.worldToLocal(hit.point.clone());
      const n = hit.face.normal.clone();
      if (n.dot(raycaster.ray.direction) > 0) n.negate();
      ghost.current = {
        pick: { part: hit.object.userData.partId, decalId: null, position: [round(local.x), round(local.y), round(local.z)], normal: [round(n.x), round(n.y), round(n.z)] },
        dirty: true,
      };
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, draftKey, props.processFx]);
  useFrame(() => {
    const g = ghost.current;
    if (!g.dirty) return;
    g.dirty = false;
    view.setGhost(draft && g.pick?.part ? { ...draft, part: g.pick.part, position: g.pick.position, normal: g.pick.normal } : null);
  });
  const moveGhost = (p: PickInfo | null) => {
    if (!draft || !props.processFx) return;
    ghost.current = { pick: p, dirty: true };
    invalidate();
  };

  // 矢印キー / ボタンでの微調整移動: 接平面上でずらして表面へ投影し直す
  const nudge = props.nudgeRequest;
  const onNudged = props.onNudged;
  useEffect(() => {
    if (!nudge || !onNudged) return;
    const d = props.design.decals.find((x: Decal) => x.id === nudge.id);
    if (!d) return;
    const n = new THREE.Vector3(...d.normal).normalize();
    const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, n).normalize();
    const y = new THREE.Vector3().crossVectors(n, x);
    const p = new THREE.Vector3(...d.position).addScaledVector(x, nudge.dx).addScaledVector(y, nudge.dy);
    const origin = p.clone().addScaledVector(n, 0.6);
    const ray = new THREE.Raycaster(origin, n.clone().negate(), 0, 1.4);
    view.root.updateMatrixWorld(true);
    const targets = Object.values(view.meshes).filter((m) => m.name !== 'laces');
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit || !hit.face) return;
    const local = view.root.worldToLocal(hit.point.clone());
    const hn = hit.face.normal.clone();
    if (hn.dot(n) < 0) hn.negate();
    onNudged(nudge.id, {
      part: hit.object.userData.partId,
      decalId: null,
      position: [round(local.x), round(local.y), round(local.z)],
      normal: [round(hn.x), round(hn.y), round(hn.z)],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge?.nonce]);

  return (
    <primitive
      object={view.root}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8 || props.dragMode) return;
        const p = toPick(e, view.root, !!props.placing || !!props.spray, !!props.placing);
        if (p) props.onPick?.(p);
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        if (!props.dragMode) return;
        e.stopPropagation();
        const p = toPick(e, view.root, true, true);
        if (!p) return;
        dragging.current = true;
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
        props.onDrag?.(p);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (draft) moveGhost(toPick(e, view.root, true, true));
        if (!props.dragMode || !dragging.current) return;
        e.stopPropagation();
        const p = toPick(e, view.root, true, true);
        if (p) props.onDrag?.(p);
      }}
      onPointerOut={() => {
        if (draft && ghost.current.pick && !dragging.current) moveGhost(null);
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (!dragging.current) return;
        e.stopPropagation();
        dragging.current = false;
        props.onDragEnd?.();
      }}
    />
  );
}

/** カメラの縦の画角（度） */
const FOV = 32;

/** 型ごとの外形の点（アッパーとソールの頂点を間引いたもの）。視点を引く量を決めるのに使う */
const outlineCache = new WeakMap<BaseModelDef, THREE.Vector3[]>();
function outlinePoints(def: BaseModelDef): THREE.Vector3[] {
  let pts = outlineCache.get(def);
  if (pts) return pts;
  pts = [];
  const geos = getGeometries(def);
  for (const id of ['upper', 'midsole', 'outsole'] as const) {
    const pos = geos[id].getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 160));
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  }
  outlineCache.set(def, pts);
  return pts;
}

/**
 * 縦長の画面でも靴全体が収まるよう、視点を注視点から遠ざける（収まっていれば元の位置のまま）。
 * 靴の外形の点を投影し、すべてが画面の 90% 以内に入る最短の距離を二分探索で求める。
 */
export function fitCamera(pos: Vec3, target: Vec3, aspect: number, points: THREE.Vector3[]): THREE.Vector3 {
  const p = new THREE.Vector3(...pos);
  const t = new THREE.Vector3(...target);
  if (!(aspect > 0)) return p;
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
  const dir = p.clone().sub(t);
  const q = new THREE.Vector3();
  const fits = (k: number) => {
    cam.position.copy(t).addScaledVector(dir, k);
    cam.lookAt(t);
    cam.updateMatrixWorld();
    return points.every((c) => {
      q.copy(c).project(cam);
      return Math.abs(q.x) <= 0.9 && Math.abs(q.y) <= 0.9;
    });
  };
  if (fits(1)) return p;
  let lo = 1;
  let hi = 3;
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }
  return t.addScaledVector(dir, hi);
}

function CameraRig({
  def,
  initial,
  request,
  controls,
  designId,
}: {
  def: ReturnType<typeof getBaseModel>;
  initial?: CameraState | null;
  request?: { preset: ViewPreset; nonce: number } | null;
  controls: React.MutableRefObject<OrbitControlsImpl | null>;
  designId: string;
}) {
  const { camera, invalidate, size } = useThree();
  const aspect = size.width / size.height;
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t0: number } | null>(null);

  // 作品を開いたとき: 最後に見ていた角度へ
  useEffect(() => {
    const tgt = initial?.target ?? def.target;
    const pos = initial?.position ? new THREE.Vector3(...initial.position) : fitCamera(def.defaultCamera, def.target, aspect, outlinePoints(def));
    camera.position.copy(pos);
    controls.current?.target.set(...tgt);
    controls.current?.update();
    camera.lookAt(...tgt);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId]);

  useEffect(() => {
    if (!request) return;
    const c = controls.current;
    anim.current = {
      from: camera.position.clone(),
      to: fitCamera(def.presets[request.preset], def.target, aspect, outlinePoints(def)),
      fromT: c ? c.target.clone() : new THREE.Vector3(...def.target),
      toT: new THREE.Vector3(...def.target),
      t0: performance.now(),
    };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.t0) / 450);
    const k = 1 - (1 - t) ** 3;
    // 半径を補間しつつ方向を球面補間（注視点まわりに回り込む）
    const r0 = a.from.clone().sub(a.fromT);
    const r1 = a.to.clone().sub(a.toT);
    const len = THREE.MathUtils.lerp(r0.length(), r1.length(), k);
    const dir = r0.normalize().lerp(r1.normalize(), k).normalize();
    const tgt = a.fromT.clone().lerp(a.toT, k);
    camera.position.copy(tgt).addScaledVector(dir, len);
    controls.current?.target.copy(tgt);
    controls.current?.update();
    camera.lookAt(tgt);
    if (t >= 1) {
      anim.current = null;
      controls.current?.dispatchEvent({ type: 'end' } as never);
    }
    invalidate();
  });
  return null;
}

export function SneakerCanvas(props: SneakerCanvasProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const def = getBaseModel(props.design.baseModel);
  const showFps = typeof location !== 'undefined' && location.search.includes('fps');
  return (
    <div ref={container} className={'sneaker-canvas ' + (props.className ?? '')} data-testid="viewport">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ fov: FOV, near: 0.1, far: 100, position: props.initialCamera?.position ?? def.defaultCamera }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Studio />
        <FrameCounter />
        <Scene {...props} controls={controls} container={container} />
        <OrbitControls
          ref={controls}
          makeDefault
          enabled={!props.dragMode}
          enableDamping
          dampingFactor={0.12}
          minDistance={2.6}
          maxDistance={12}
          target={props.initialCamera?.target ?? def.target}
          onEnd={() => {
            const c = controls.current;
            if (!c || !props.onCameraChange) return;
            const p = c.object.position;
            props.onCameraChange({ position: [round(p.x), round(p.y), round(p.z)], target: [round(c.target.x), round(c.target.y), round(c.target.z)] });
          }}
        />
        <CameraRig def={def} initial={props.initialCamera} request={props.viewRequest} controls={controls} designId={props.design.id} />
      </Canvas>
      {showFps && <FpsMeter />}
    </div>
  );
}

function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = (window as unknown as { __sfFrames?: number }).__sfFrames ?? 0;
    const id = setInterval(() => {
      const now = (window as unknown as { __sfFrames?: number }).__sfFrames ?? 0;
      if (ref.current) ref.current.textContent = `${now - last} fps`;
      last = now;
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <div ref={ref} className="fps-meter" data-testid="fps" />;
}
