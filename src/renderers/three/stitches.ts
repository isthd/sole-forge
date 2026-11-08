/**
 * ステッチ（縫い目）。ベース型が持つ縫い目の線（アッパーの uv1 = (s,h) 上の折れ線）をテクスチャに焼き込み、
 * uv1 を持つパーツ（アッパー・トゥ・ヒール・サイドパネル・アイステイ）のシェーダーで糸と針穴を描く。
 *
 * テクスチャ（1024px）には糸そのものではなく「線からの距離」と「線に沿った位相」を入れる:
 *   R = 線の中心で 1、外へ向かって 0（距離の山）
 *   G,B = 縫い目の周期の位相（cos, sin）
 * シェーダーがしきい値で糸の形を切り出すので、近づいても縁がにじまず、ポリゴンも増えない。
 */
import * as THREE from 'three';
import type { StitchLine } from '../../models/sneakerBuilder';

const W = 1024;
const H = 1024;
/** 縫い目 1 目の長さ（実寸。単位はおよそ 10cm） */
const STITCH_PERIOD = 0.045;
/** 距離の山の半径（実寸）。シェーダーは山の半分の高さで糸を切るので、糸の幅はおよそこの値 */
const PROFILE_RADIUS = 0.016;

/** 縁（コバ）の塗りの幅（実寸。パーツの内側へ約 1.2mm） */
const EDGE_WIDTH = 0.012;

const cache = new WeakMap<object, THREE.DataTexture>();

/**
 * 縫い目と縁の塗りのテクスチャ。A = 1 − 縁の塗りの濃さ（縁の線の左側＝パーツの内側だけに塗る）。
 * キャッシュは縫い目の配列（ベース型＋形ごとに 1 つ）で引く。
 */
export function getStitchTexture(lines: StitchLine[], edges: StitchLine[] = []): THREE.DataTexture {
  const hit = cache.get(lines);
  if (hit) return hit;
  const data = new Uint8Array(W * H * 4);
  const prof = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      const [s0, h0, l0, js0, jh0] = line[k - 1];
      const [s1, h1, l1, js1, jh1] = line[k];
      // この区間の 1 ピクセルあたりの実寸
      const sx = (js0 + js1) / 2 / W;
      const sy = (jh0 + jh1) / 2 / H;
      const x0 = s0 * W;
      const y0 = h0 * H;
      const x1 = s1 * W;
      const y1 = h1 * H;
      const ex = Math.ceil(PROFILE_RADIUS / sx) + 1;
      const ey = Math.ceil(PROFILE_RADIUS / sy) + 1;
      const dxp = (x1 - x0) * sx;
      const dyp = (y1 - y0) * sy;
      const segLen2 = dxp * dxp + dyp * dyp || 1e-12;
      const yA = Math.max(0, Math.floor(Math.min(y0, y1)) - ey);
      const yB = Math.min(H - 1, Math.ceil(Math.max(y0, y1)) + ey);
      const xA = Math.floor(Math.min(x0, x1)) - ex;
      const xB = Math.ceil(Math.max(x0, x1)) + ex;
      for (let py = yA; py <= yB; py++) {
        for (let px = xA; px <= xB; px++) {
          const qx = (px + 0.5 - x0) * sx;
          const qy = (py + 0.5 - y0) * sy;
          const t = Math.min(1, Math.max(0, (qx * dxp + qy * dyp) / segLen2));
          const d = Math.hypot(qx - t * dxp, qy - t * dyp);
          if (d >= PROFILE_RADIUS) continue;
          const v = 1 - d / PROFILE_RADIUS;
          // s は 1 周で折り返す（つま先の帯は負の s を持つ）
          const ix = (((px % W) + W) % W) + py * W;
          if (v <= prof[ix]) continue;
          prof[ix] = v;
          const ph = ((l0 + (l1 - l0) * t) / STITCH_PERIOD) * Math.PI * 2;
          data[ix * 4] = Math.round(v * 255);
          data[ix * 4 + 1] = Math.round((Math.cos(ph) * 0.5 + 0.5) * 255);
          data[ix * 4 + 2] = Math.round((Math.sin(ph) * 0.5 + 0.5) * 255);
        }
      }
    }
  }
  const edge = new Float32Array(W * H);
  for (const line of edges) {
    for (let k = 1; k < line.length; k++) {
      const [s0, h0, , js0, jh0] = line[k - 1];
      const [s1, h1, , js1, jh1] = line[k];
      const sx = (js0 + js1) / 2 / W;
      const sy = (jh0 + jh1) / 2 / H;
      const x0 = s0 * W;
      const y0 = h0 * H;
      const dxp = (s1 - s0) * W * sx;
      const dyp = (h1 - h0) * H * sy;
      const segLen = Math.hypot(dxp, dyp);
      if (segLen < 1e-9) continue;
      const ex = Math.ceil(EDGE_WIDTH / sx) + 1;
      const ey = Math.ceil(EDGE_WIDTH / sy) + 1;
      const yA = Math.max(0, Math.floor(Math.min(y0, h1 * H)) - ey);
      const yB = Math.min(H - 1, Math.ceil(Math.max(y0, h1 * H)) + ey);
      const xA = Math.floor(Math.min(x0, s1 * W)) - ex;
      const xB = Math.ceil(Math.max(x0, s1 * W)) + ex;
      for (let py = yA; py <= yB; py++) {
        for (let px = xA; px <= xB; px++) {
          const qx = (px + 0.5 - x0) * sx;
          const qy = (py + 0.5 - y0) * sy;
          const t = (qx * dxp + qy * dyp) / (segLen * segLen);
          if (t < -0.02 || t > 1.02) continue;
          // 左側（内側）までの距離。わずかに外へはみ出させて、丸めた縁の頂点（縁と同じ uv）も確実に塗る
          const sd = (dxp * qy - dyp * qx) / segLen;
          if (sd < -0.003 || sd > EDGE_WIDTH) continue;
          const v = 1 - Math.max(0, sd - EDGE_WIDTH * 0.5) / (EDGE_WIDTH * 0.5);
          const ix = (((px % W) + W) % W) + py * W;
          if (v > edge[ix]) {
            edge[ix] = v;
            data[ix * 4 + 3] = Math.round((1 - v) * 255);
          }
        }
      }
    }
  }
  // DataTexture は 1 行目が v = 0（下）。h をそのまま行にしたので上下反転は不要
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cache.set(lines, tex);
  return tex;
}

/** 糸の色: 生地と同系色で、明るい生地は少し濃く、暗い生地は少し明るく（トーンを揃えた縫い糸） */
export function threadColor(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return l > 0.3 ? c.multiplyScalar(0.8) : c.lerp(new THREE.Color('#FFFFFF'), 0.28);
}

/**
 * マテリアルにステッチを描かせる。geometry は uv1 を持つこと（sfSkin として共有して渡す）。
 * 塗りの演出（paintFx）はこの onBeforeCompile を引き継いで重ねる。
 */
export function applyStitches(
  mat: THREE.MeshPhysicalMaterial,
  geo: THREE.BufferGeometry,
  tex: THREE.Texture,
  color: THREE.Color,
  /** 縁（コバ）を塗るか。重ねたパーツだけ（アッパー自体は塗らない） */
  edgePaint = false,
) {
  const uv1 = geo.getAttribute('uv1');
  if (!uv1) return;
  // 組み込みの uv1 は素材の凹凸の設定しだいでシェーダーに入らないので、同じバッファを別名で渡す
  if (geo.getAttribute('sfSkin') !== uv1) geo.setAttribute('sfSkin', uv1);
  const uniforms = {
    uSfStitch: { value: tex },
    uSfThread: { value: color },
    // 糸の盛り上がり（実寸）。約 0.4mm
    uSfStitchBump: { value: 0.004 },
    uSfEdgePaint: { value: edgePaint ? 1 : 0 },
  };
  mat.userData.sfStitchUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 sfSkin;\nvarying vec2 vSfSkin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSfSkin = sfSkin;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vSfSkin;
uniform sampler2D uSfStitch;
uniform vec3 uSfThread;
uniform float uSfStitchBump;
uniform float uSfEdgePaint;
// x = 糸, y = 針穴, z = 糸の盛り上がり
vec3 sfStitchMask() {
  vec4 t = texture2D(uSfStitch, vSfSkin);
  vec2 ph = t.gb * 2.0 - 1.0;
  // 線から遠い・遠景で位相が平均されて弱いところは描かない
  float live = smoothstep(0.3, 0.65, length(ph)) * step(0.02, t.r);
  // 1 目を楕円にする: u = 目の中心からの位置（±1 が目の端）, v = 線の中心からの距離（±1 が糸の縁）
  float u = atan(ph.y, ph.x) / (0.62 * PI);
  float v = (1.0 - t.r) / 0.5;
  float e = u * u + v * v;
  float ew = clamp(fwidth(e), 0.02, 0.4);
  float thread = (1.0 - smoothstep(1.0 - ew, 1.0 + ew, e)) * live;
  // 針穴: 目と目の間（u ≈ ±1.6）の線の中心
  float g = (abs(u) - 1.6) / 0.22;
  float hole = (1.0 - smoothstep(0.6, 1.0, g * g + v * v * 4.0)) * live;
  float bulge = sqrt(max(0.0, 1.0 - e)) * live;
  return vec3(thread, hole, bulge);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 sfSt = sfStitchMask();
float sfEdge = (1.0 - texture2D(uSfStitch, vSfSkin).a) * uSfEdgePaint;
diffuseColor.rgb *= 1.0 - 0.22 * sfEdge;
diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.3 * sfSt.y), uSfThread, sfSt.x);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // 糸の盛り上がりと溝を高さとして法線を傾ける（three.js の bump と同じ式）
  float sfH = (sfSt.z - 0.5 * sfSt.y) * uSfStitchBump;
  vec3 sfPx = dFdx(-vViewPosition);
  vec3 sfPy = dFdy(-vViewPosition);
  vec3 sfR1 = cross(sfPy, normal);
  vec3 sfR2 = cross(normal, sfPx);
  float sfDet = dot(sfPx, sfR1) * faceDirection;
  vec3 sfGrad = sign(sfDet) * (dFdx(sfH) * sfR1 + dFdy(sfH) * sfR2);
  normal = normalize(abs(sfDet) * normal - sfGrad);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'sf-stitch-v1';
  mat.needsUpdate = true;
}
