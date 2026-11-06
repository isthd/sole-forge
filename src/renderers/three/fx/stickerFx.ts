/**
 * ステッカー（デカール）を貼る / はがす演出。
 *  - デカールのマテリアルに頂点シェーダーを足し、押し付け済みでない部分を付け根から反り上がらせる
 *    （processMath.peelOffset と同じ式）
 *  - 押し付けるヘラ（スキージー）を手続き的に作る（SOLE FORGE のライム色）
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PEEL_RADIUS } from './processMath';

export interface StickerUniforms {
  uSfPeel: { value: number };
  uSfAngle: { value: number };
  uSfLift: { value: number };
  uSfW: { value: number };
  uSfT: { value: THREE.Vector3 };
  uSfN: { value: THREE.Vector3 };
  uSfFlash: { value: number };
}

/** すべてのデカールに使う（貼り終わった状態 = peel 2 では形は変わらない） */
export function patchSticker(mat: THREE.MeshStandardMaterial): StickerUniforms {
  const u: StickerUniforms = {
    uSfPeel: { value: 2 },
    uSfAngle: { value: 0.6 },
    uSfLift: { value: 0 },
    uSfW: { value: 0.4 },
    uSfT: { value: new THREE.Vector3(1, 0, 0) },
    uSfN: { value: new THREE.Vector3(0, 0, 1) },
    uSfFlash: { value: 0 },
  };
  const R = PEEL_RADIUS.toFixed(4);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSfPeel;
uniform float uSfAngle;
uniform float uSfLift;
uniform float uSfW;
uniform vec3 uSfT;
uniform vec3 uSfN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float sfS = (uv.x - uSfPeel) * uSfW;
  if (sfS > 0.0) {
    float sfTh = min(sfS / ${R}, uSfAngle);
    float sfRest = max(sfS - ${R} * uSfAngle, 0.0);
    float sfOt = ${R} * sin(sfTh) + cos(uSfAngle) * sfRest - sfS;
    float sfOn = ${R} * (1.0 - cos(sfTh)) + sin(uSfAngle) * sfRest;
    transformed += uSfT * sfOt + uSfN * sfOn;
  }
  transformed += uSfN * uSfLift;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSfFlash;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.78, 1.0, 0.0) * (uSfFlash * 0.55);');
  };
  mat.customProgramCacheKey = () => 'sf-sticker-v1';
  mat.needsUpdate = true;
  return u;
}

/**
 * スキージー（ヘラ）。原点 = 表面に当たる刃先、+y = 刃の長さ方向、+z = 表面から離れる方向。
 * 高さ 1 の刃として作り、貼るデカールの高さに合わせて y を拡大する。
 */
export function buildSqueegee(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fx:squeegee';
  const blade = new THREE.Mesh(
    new RoundedBoxGeometry(0.022, 1, 0.1, 2, 0.008),
    new THREE.MeshStandardMaterial({ color: '#C6FF00', roughness: 0.38, metalness: 0, emissive: '#C6FF00', emissiveIntensity: 0.08 }),
  );
  blade.position.z = 0.05;
  const grip = new THREE.Mesh(
    new RoundedBoxGeometry(0.05, 0.62, 0.075, 2, 0.02),
    new THREE.MeshStandardMaterial({ color: '#1A1A1E', roughness: 0.6, metalness: 0.1 }),
  );
  grip.position.z = 0.13;
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 1.01, 0.012),
    new THREE.MeshStandardMaterial({ color: '#F2F2EE', roughness: 0.7 }),
  );
  edge.position.z = 0.004;
  g.add(blade, grip, edge);
  g.traverse((o) => {
    (o as THREE.Mesh).raycast = () => {};
  });
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
