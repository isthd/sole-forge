/**
 * 塗り広げの演出（シェーダー）。
 * 変更前の見た目のマテリアルを同じ形の「上塗り前レイヤー」に付け替え、
 * 起点からの距離が半径より内側の部分を捨てる（discard）ことで、下の新しい色が広がって見えるようにする。
 * 縁はノイズでギザギザにし、縁の少し先にはスプレーのしぶき（点々）と、新しい色のうっすらとした霧をのせる。
 * 素材の変更では、しぶきの代わりにライムの光る継ぎ目が走る。
 */
import * as THREE from 'three';
import { EDGE_NOISE } from './processMath';

export interface PaintUniforms {
  uSfOrigin: { value: THREE.Vector3 };
  uSfRadius: { value: number };
  uSfTint: { value: THREE.Color };
  uSfTintAmt: { value: number };
  uSfGlow: { value: THREE.Color };
  uSfGlowAmt: { value: number };
  uSfSpeckle: { value: number };
}

export const NOISE_GLSL = /* glsl */ `
float sfHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sfNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sfHash(i), sfHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sfHash(i + vec3(0.0, 1.0, 0.0)), sfHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(sfHash(i + vec3(0.0, 0.0, 1.0)), sfHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sfHash(i + vec3(0.0, 1.0, 1.0)), sfHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

/**
 * マテリアルを「塗られていく前の層」に作り替える。返した uniforms を毎フレーム動かす。
 * 同じシェーダーを使い回せるよう customProgramCacheKey を固定する。
 */
export function makePaintOverlay(mat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial): PaintUniforms {
  const uniforms: PaintUniforms = {
    uSfOrigin: { value: new THREE.Vector3() },
    uSfRadius: { value: -1 },
    uSfTint: { value: new THREE.Color('#ffffff') },
    uSfTintAmt: { value: 0 },
    uSfGlow: { value: new THREE.Color('#C6FF00') },
    uSfGlowAmt: { value: 0 },
    uSfSpeckle: { value: 0 },
  };
  // 元のマテリアルの改造（ステッチなど）を先に当ててから重ねる
  const base = mat.onBeforeCompile.bind(mat);
  const baseKey = mat.userData.sfStitchUniforms ? mat.customProgramCacheKey() + '|' : '';
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSfPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSfPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSfPos;
uniform vec3 uSfOrigin;
uniform float uSfRadius;
uniform vec3 uSfTint;
uniform float uSfTintAmt;
uniform vec3 uSfGlow;
uniform float uSfGlowAmt;
uniform float uSfSpeckle;
${NOISE_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float sfN = sfNoise(vSfPos * 7.0) * 0.65 + sfNoise(vSfPos * 21.0) * 0.35;
float sfFront = uSfRadius - (distance(vSfPos, uSfOrigin) + (sfN - 0.5) * ${EDGE_NOISE.toFixed(3)});
if (sfFront > 0.0) discard;
if (uSfSpeckle > 0.0 && sfFront > -uSfSpeckle) {
  float sfS = sfHash(floor(vSfPos * 130.0));
  if (sfS > 0.42 + 0.58 * (-sfFront / uSfSpeckle)) discard;
}
float sfMist = smoothstep(-0.24, 0.0, sfFront);
float sfSeam = smoothstep(-0.07, 0.0, sfFront);`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSfTint, sfMist * uSfTintAmt);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSfGlow * (sfSeam * uSfGlowAmt);');
  };
  mat.customProgramCacheKey = () => baseKey + 'sf-paint-overlay-v1';
  // 下の新しい層より手前に描く（同じ形なので深度をずらす）。デカールはさらに手前（-4）
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
  mat.needsUpdate = true;
  return uniforms;
}
