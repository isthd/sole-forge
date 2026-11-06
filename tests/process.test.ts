import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  APPLY_DURATION,
  EDGE_NOISE,
  PEEL_ANGLE,
  PEEL_RADIUS,
  REMOVE_DURATION,
  ROTATE_HANDLE_GAP,
  SCALE_MAX,
  SCALE_MIN,
  SPECKLE_BAND,
  applyPose,
  changedParts,
  classifyChange,
  coverRadius,
  decalBasis,
  decalSize,
  dragRotation,
  dragScale,
  dryFactor,
  gizmoAnchors,
  insideDecal,
  paintDuration,
  paintRadius,
  peelOffset,
  removePose,
  staggerDelays,
  wrapDeg,
} from '../src/renderers/three/fx/processMath';
import { makePaintOverlay } from '../src/renderers/three/fx/paintFx';
import { patchSticker } from '../src/renderers/three/fx/stickerFx';
import { DEFAULT_PARTS } from '../src/models/design';
import type { PartStyle, Vec3 } from '../src/models/types';

describe('塗りの演出（計算）', () => {
  const base: PartStyle = { color: '#F2F2EE', material: 'leather' };

  it('変化を「塗り」と「素材の張り替え」に分ける', () => {
    expect(classifyChange(base, { ...base })).toBeNull();
    expect(classifyChange(base, { ...base, color: '#FF0000' })).toBe('paint');
    expect(classifyChange(base, { ...base, pattern: { type: 'dot', colors: ['#000000', '#FFFFFF'] } })).toBe('paint');
    expect(classifyChange(base, { ...base, material: 'suede' })).toBe('material');
    expect(classifyChange(base, { ...base, material: 'suede', color: '#FF0000' })).toBe('material');
    expect(classifyChange(undefined, base)).toBeNull();
  });

  it('変わったパーツだけをパーツ順に返す（前が無ければ演出しない）', () => {
    const next = { ...DEFAULT_PARTS, laces: { ...DEFAULT_PARTS.laces, color: '#000000' }, upper: { ...DEFAULT_PARTS.upper, material: 'mesh' as const } };
    expect(changedParts(DEFAULT_PARTS, next)).toEqual([
      { part: 'upper', kind: 'material' },
      { part: 'laces', kind: 'paint' },
    ]);
    expect(changedParts(null, next)).toEqual([]);
  });

  it('覆う半径はボックスのどの隅にも届く', () => {
    const min: Vec3 = [-1.5, 0, -0.6];
    const max: Vec3 = [1.5, 1.2, 0.6];
    for (const origin of [[0, 0.6, 0.6], [-1.5, 0, 0], [0.7, 1.1, -0.3]] as Vec3[]) {
      const r = coverRadius(min, max, origin);
      for (let i = 0; i < 8; i++) {
        const c = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
        expect(Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2])).toBeLessThanOrEqual(r + 1e-9);
      }
    }
  });

  it('塗り広がりは 0 から始まって単調に広がり、終わりには縁のノイズとしぶきまで覆い切る', () => {
    const cover = 2.4;
    const dur = paintDuration(cover);
    expect(paintRadius(0, dur, cover)).toBe(0);
    let prev = -1;
    for (let t = 0; t <= dur + 0.2; t += 0.02) {
      const r = paintRadius(t, dur, cover);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(paintRadius(dur, dur, cover)).toBeGreaterThan(cover + EDGE_NOISE / 2 + SPECKLE_BAND);
  });

  it('時間は大きさに応じつつ待たされない長さ（素材の張り替えは少し速い）', () => {
    expect(paintDuration(0.2)).toBeGreaterThanOrEqual(0.8);
    expect(paintDuration(10)).toBeLessThanOrEqual(1.9);
    expect(paintDuration(2)).toBeGreaterThan(paintDuration(1));
    expect(paintDuration(2, 'material')).toBeLessThan(paintDuration(2, 'paint'));
  });

  it('複数パーツは少しずつずらして始め、塗りたての艶は乾いていく', () => {
    expect(staggerDelays(3, 0.1)).toEqual([0, 0.1, 0.2]);
    expect(dryFactor(0, 1)).toBe(0);
    expect(dryFactor(0.5, 1)).toBe(0);
    expect(dryFactor(1.3, 1)).toBeGreaterThan(0.3);
    expect(dryFactor(2.2, 1)).toBe(1);
  });
});

describe('ステッカーの演出（計算）', () => {
  it('付け根より手前は動かず、先は円弧 → 一定の角度で浮く', () => {
    expect(peelOffset(0)).toEqual([0, 0]);
    expect(peelOffset(-0.3)).toEqual([0, 0]);
    // 付け根のごく近くはほとんど浮かない（なめらかにつながる）
    const [t0, n0] = peelOffset(0.001);
    expect(Math.abs(t0)).toBeLessThan(1e-4);
    expect(n0).toBeLessThan(1e-4);
    // 円弧より先は角度 PEEL_ANGLE の直線
    const a = peelOffset(0.3);
    const b = peelOffset(0.4);
    const slope = (b[1] - a[1]) / (0.1 + (b[0] - a[0]));
    expect(slope).toBeCloseTo(Math.tan(PEEL_ANGLE), 5);
    // 長さは保たれる（付け根からの距離は s を超えない）
    for (const s of [0.02, PEEL_RADIUS * PEEL_ANGLE, 0.2, 0.6]) {
      const [dt, dn] = peelOffset(s);
      expect(Math.hypot(s + dt, dn)).toBeLessThanOrEqual(s + 1e-9);
      expect(dn).toBeGreaterThan(0);
    }
  });

  it('貼る: 浮いた状態で現れ、左から押し付け、最後は完全に平らで光が消える', () => {
    const p0 = applyPose(0);
    expect(p0.opacity).toBe(0);
    expect(p0.lift).toBeGreaterThan(0.1);
    expect(p0.peel).toBe(0);
    let prev = -1;
    for (let t = 0; t <= APPLY_DURATION; t += 0.01) {
      const p = applyPose(t);
      expect(p.peel).toBeGreaterThanOrEqual(prev);
      prev = p.peel;
    }
    const mid = applyPose(0.6);
    expect(mid.peel).toBeGreaterThan(0.2);
    expect(mid.peel).toBeLessThan(0.95);
    expect(mid.tool).toBe(1);
    const end = applyPose(APPLY_DURATION);
    expect(end.peel).toBeGreaterThanOrEqual(1);
    expect(end.lift).toBe(0);
    expect(end.opacity).toBe(1);
    expect(end.tool).toBe(0);
    expect(end.flash).toBe(0);
  });

  it('はがす: めくれて浮き上がり、消える', () => {
    expect(removePose(0).peel).toBeGreaterThanOrEqual(1);
    expect(removePose(0).opacity).toBe(1);
    const end = removePose(REMOVE_DURATION);
    expect(end.peel).toBeLessThan(0.01);
    expect(end.lift).toBeGreaterThan(0.2);
    expect(end.opacity).toBe(0);
  });
});

describe('3D ハンドル（計算）', () => {
  it('デカールの向きは正規直交で、法線は指定どおり', () => {
    for (const [n, r] of [
      [[0, 0, 1], 0],
      [[0.3, 0.2, 0.9], 37],
      [[0, 1, 0], -120],
      [[0, 0, 0], 10],
    ] as [Vec3, number][]) {
      const b = decalBasis(n, r);
      expect(b.x.length()).toBeCloseTo(1, 6);
      expect(b.y.length()).toBeCloseTo(1, 6);
      expect(b.x.dot(b.y)).toBeCloseTo(0, 6);
      expect(b.x.dot(b.n)).toBeCloseTo(0, 6);
      expect(new THREE.Vector3().crossVectors(b.x, b.y).dot(b.n)).toBeCloseTo(1, 6);
    }
    // 回転 + は表から見て時計回り（横向き x が下を向く）
    const b = decalBasis([0, 0, 1], 90);
    expect(b.x.y).toBeCloseTo(-1, 6);
  });

  it('大きさは長辺', () => {
    expect(decalSize(0.6, 2)).toEqual([0.6, 0.3]);
    expect(decalSize(0.6, 0.5)).toEqual([0.3, 0.6]);
  });

  it('回転ハンドル: 画面で時計回りに 90° 回すと +90°（裏から見ていると逆）。Shift で 15° 刻み', () => {
    const up = -Math.PI / 2; // 画面座標は y が下向き
    const right = 0;
    expect(dragRotation(0, up, right, 1)).toBe(90);
    expect(dragRotation(0, up, right, -1)).toBe(-90);
    expect(dragRotation(170, up, right, 1)).toBe(-100);
    expect(dragRotation(0, 0, 0.39, 1, 15)).toBe(15);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(-190)).toBe(170);
  });

  it('拡大ハンドル: 中心からの距離の比で拡大し、上限・下限に収める', () => {
    expect(dragScale(0.5, 50, 75)).toBe(0.75);
    expect(dragScale(0.5, 50, 1)).toBe(SCALE_MIN);
    expect(dragScale(1.2, 10, 100)).toBe(SCALE_MAX);
    expect(dragScale(0.5, 0, 10)).toBe(SCALE_MAX);
  });

  it('ハンドルの位置: 回転は上辺の上、拡大は右下の角。範囲内の判定', () => {
    const a = gizmoAnchors([0, 1, 0.5], [0, 0, 1], 0, 0.4, 2, 0);
    expect(a.w).toBeCloseTo(0.4);
    expect(a.h).toBeCloseTo(0.2);
    expect(a.rotate.y).toBeCloseTo(1 + 0.1 + ROTATE_HANDLE_GAP);
    expect(a.scale.x).toBeCloseTo(0.2);
    expect(a.scale.y).toBeCloseTo(0.9);
    expect(a.corners).toHaveLength(4);
    expect(insideDecal([0.1, 1.05, 0.5], [0, 1, 0.5], a.basis, a.w, a.h)).toBe(true);
    expect(insideDecal([0.25, 1, 0.5], [0, 1, 0.5], a.basis, a.w, a.h)).toBe(false);
    expect(insideDecal([0, 1, 1.2], [0, 1, 0.5], a.basis, a.w, a.h)).toBe(false);
  });
});

describe('シェーダーの差し込み（three の更新でチャンク名が変わっても気づけるように）', () => {
  const compile = (mat: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) => {
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    mat.onBeforeCompile(shader as never, null as never);
    return shader;
  };

  it('塗り広げ: 物理マテリアルの位置・破棄・霧・継ぎ目を差し込む', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    const u = makePaintOverlay(mat);
    const s = compile(mat, THREE.ShaderLib.physical);
    expect(s.vertexShader).toContain('vSfPos = transformed;');
    expect(s.fragmentShader).toContain('if (sfFront > 0.0) discard;');
    expect(s.fragmentShader).toContain('mix(diffuseColor.rgb, uSfTint');
    expect(s.fragmentShader).toContain('totalEmissiveRadiance += uSfGlow');
    expect(s.uniforms.uSfRadius).toBe(u.uSfRadius);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.customProgramCacheKey()).toBe('sf-paint-overlay-v1');
  });

  it('ステッカー: 標準マテリアルの頂点に反りを、フラグメントに発光を差し込む', () => {
    const mat = new THREE.MeshStandardMaterial();
    const u = patchSticker(mat);
    const s = compile(mat, THREE.ShaderLib.standard);
    expect(s.vertexShader).toContain('float sfS = (uv.x - uSfPeel) * uSfW;');
    expect(s.vertexShader).toContain('transformed += uSfN * uSfLift;');
    expect(s.fragmentShader).toContain('uSfFlash * 0.55');
    expect(s.uniforms.uSfPeel).toBe(u.uSfPeel);
    expect(u.uSfPeel.value).toBeGreaterThan(1); // 既定は貼り終わった形
  });
});
