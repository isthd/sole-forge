/**
 * オフスクリーン描画。好きな角度を高解像度で再レンダリングして PNG にする。
 * サムネイル・単体書き出し・棚全体書き出しで共通に使う。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CameraState, SneakerDesign } from '../../models/types';
import { modelOf } from '../../models';
import { SneakerView, addStageLights } from './SneakerView';

let renderer: THREE.WebGLRenderer | null = null;
let envTex: THREE.Texture | null = null;

function getRenderer() {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  return renderer;
}

export function maxRenderSize(): number {
  const r = getRenderer();
  const gl = r.getContext();
  const a = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const v = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  return Math.min(a, v[0], v[1], 4096);
}

export interface RenderOptions {
  width: number;
  height: number;
  /** null = 透過 */
  background: string | null;
  camera?: CameraState | null;
  fov?: number;
  shadow?: boolean;
}

export async function renderDesignCanvas(design: SneakerDesign, opt: RenderOptions): Promise<HTMLCanvasElement> {
  const r = getRenderer();
  const def = modelOf(design);
  const scene = new THREE.Scene();
  scene.environment = envTex;
  addStageLights(scene);
  const view = new SneakerView(def);
  view.setParts(design.parts, null);
  await view.setDecals(design.decals, null);
  view.shadow.visible = opt.shadow ?? opt.background !== null;
  scene.add(view.root);

  const cam = new THREE.PerspectiveCamera(opt.fov ?? 32, opt.width / opt.height, 0.1, 100);
  const pos = opt.camera?.position ?? def.defaultCamera;
  const tgt = opt.camera?.target ?? def.target;
  cam.position.set(...pos);
  cam.lookAt(new THREE.Vector3(...tgt));

  const size = maxRenderSize();
  const k = Math.min(1, size / Math.max(opt.width, opt.height));
  const w = Math.round(opt.width * k);
  const h = Math.round(opt.height * k);
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  if (opt.background) {
    r.setClearColor(new THREE.Color(opt.background), 1);
  } else {
    r.setClearColor(0x000000, 0);
  }
  r.render(scene, cam);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(r.domElement, 0, 0);
  view.dispose();
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 生成に失敗しました'))), 'image/png'));
}

export async function renderDesignPNG(design: SneakerDesign, opt: RenderOptions): Promise<Blob> {
  return canvasToBlob(await renderDesignCanvas(design, opt));
}

export const THUMB_SIZE = 384;
export function renderThumbnail(design: SneakerDesign): Promise<Blob> {
  return renderDesignPNG(design, { width: THUMB_SIZE, height: THUMB_SIZE, background: null, camera: null, shadow: true });
}

/** iOS Safari の Canvas 面積上限（約 1677 万画素）に収める */
export const MAX_CANVAS_AREA = 16_777_216;

export interface ShelfExportResult {
  blob: Blob;
  scale: number; // 実際に使った倍率
  width: number;
  height: number;
}

/** 棚全体を 1 枚の PNG に。各作品を書き出し倍率で再レンダリングして並べる。 */
export async function renderShelfPNG(designs: SneakerDesign[], scale: number, onProgress?: (i: number, n: number) => void): Promise<ShelfExportResult> {
  const cols = Math.min(4, Math.max(1, designs.length));
  const rows = Math.max(1, Math.ceil(designs.length / cols));
  const cellW = 300;
  const cellH = 300;
  const pad = 40;
  const header = 110;
  const label = 46;
  const board = 18;
  const baseW = pad * 2 + cols * cellW;
  const baseH = header + rows * (cellH + label + board + 24) + pad;
  let k = scale;
  while (k > 1 && baseW * k * baseH * k > MAX_CANVAS_AREA) k /= 2;
  if (baseW * k * baseH * k > MAX_CANVAS_AREA) k = Math.sqrt(MAX_CANVAS_AREA / (baseW * baseH));

  const c = document.createElement('canvas');
  c.width = Math.round(baseW * k);
  c.height = Math.round(baseH * k);
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  // 背景（コンクリート調）
  ctx.fillStyle = '#0E0E10';
  ctx.fillRect(0, 0, baseW, baseH);
  const noise = document.createElement('canvas');
  noise.width = noise.height = 128;
  const nctx = noise.getContext('2d')!;
  const img = nctx.createImageData(128, 128);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 20 + (seed % 18);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 60;
  }
  nctx.putImageData(img, 0, 0);
  ctx.fillStyle = ctx.createPattern(noise, 'repeat')!;
  ctx.fillRect(0, 0, baseW, baseH);
  // ヘッダー
  ctx.fillStyle = '#C6FF00';
  ctx.font = '700 44px "Oswald", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('SOLE FORGE', pad, 66);
  ctx.fillStyle = '#9A9AA2';
  ctx.font = '500 18px "Oswald", "Noto Sans JP", sans-serif';
  ctx.fillText(`MY COLLECTION — ${designs.length} PAIRS`, pad, 94);

  for (let i = 0; i < designs.length; i++) {
    onProgress?.(i, designs.length);
    const d = designs[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * cellW;
    const y = header + row * (cellH + label + board + 24);
    const shoe = await renderDesignCanvas(d, {
      width: Math.round(cellW * k),
      height: Math.round(cellH * k),
      background: null,
      camera: null,
      shadow: true,
    });
    ctx.drawImage(shoe, x, y, cellW, cellH);
    // 棚板
    const by = y + cellH - 46;
    const g = ctx.createLinearGradient(0, by, 0, by + board);
    g.addColorStop(0, '#3A3A40');
    g.addColorStop(1, '#1C1C20');
    ctx.fillStyle = g;
    ctx.fillRect(x + 6, by, cellW - 12, board);
    ctx.fillStyle = '#F2F2EE';
    ctx.font = '700 20px "Noto Sans JP", sans-serif';
    const name = d.name.length > 16 ? d.name.slice(0, 15) + '…' : d.name;
    ctx.fillText((d.favorite ? '★ ' : '') + name, x + 12, by + board + 30);
  }
  onProgress?.(designs.length, designs.length);
  return { blob: await canvasToBlob(c), scale: k, width: c.width, height: c.height };
}
