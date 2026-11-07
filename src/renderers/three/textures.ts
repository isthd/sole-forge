/**
 * Canvas で生成するテクスチャ（すべて 1024px 以下・外部ファイルなし）。
 *  - 素材ごとのノーマルマップ（レザーのシボ、スエードの毛羽、メッシュの穴、キャンバスの織り目、
 *    ニットの編み目、メタリックのヘアライン、ラバーの粒）
 *  - 柄（グラデーション / 迷彩 / チェック / ドット / ストライプ / スプラッター / マーブル）
 */
import * as THREE from 'three';
import type { MaterialId, PartStyle, PatternDirection, PatternType } from '../../models/types';
import { rng } from '../../store/random';

export const MAX_TEXTURE = 1024;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.min(w, MAX_TEXTURE);
  c.height = Math.min(h, MAX_TEXTURE);
  return c;
}

/** 周期的（タイル可能）な値ノイズ */
function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const lat = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  const f = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy);
    const ty = f(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx);
      const tx = f(gx - x0);
      const a = lat[(y0 % cells) * cells + (x0 % cells)];
      const b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function heightToNormal(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function leatherHeight(size: number) {
  const a = tileNoise(size, 48, 11);
  const b = tileNoise(size, 96, 12);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    // シボ: 谷を鋭く
    const v = 1 - Math.abs(a[i] * 2 - 1);
    out[i] = v * v * 0.8 + b[i] * 0.25;
  }
  return out;
}
function suedeHeight(size: number) {
  const a = tileNoise(size, 128, 21);
  const b = tileNoise(size, 256, 22);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = a[i] * 0.5 + b[i] * 0.5;
  return out;
}
function meshHeight(size: number) {
  // 六角格子の穴
  const out = new Float32Array(size * size);
  const n = 8;
  const cell = size / n;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / (cell * 0.5));
      const ox = row % 2 ? cell / 2 : 0;
      const cx = ((x + ox) % cell) - cell / 2;
      const cy = (y % (cell * 0.5)) - cell * 0.25;
      const d = Math.hypot(cx, cy * 1.8) / (cell * 0.32);
      out[y * size + x] = d < 1 ? 0.1 + 0.2 * d * d : 1;
    }
  }
  return out;
}
function canvasHeight(size: number) {
  const out = new Float32Array(size * size);
  const n = 32;
  const noise = tileNoise(size, 64, 31);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * n;
      const v = (y / size) * n;
      const warp = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const over = (Math.floor(u) + Math.floor(v)) % 2 ? 1 : -1;
      out[y * size + x] = 0.5 + 0.35 * warp * over + noise[y * size + x] * 0.15;
    }
  }
  return out;
}

/** ニット: V 字に並ぶ編み目（左右に傾いたループ）の格子 */
function knitHeight(size: number) {
  const out = new Float32Array(size * size);
  const cols = 24;
  const rows = 32;
  const cw = size / cols;
  const rh = size / rows;
  const noise = tileNoise(size, 64, 61);
  const lobe = (dx: number, dy: number, tilt: number) => {
    const c = Math.cos(tilt);
    const sn = Math.sin(tilt);
    const u = (dx * c - dy * sn) / 0.26;
    const v = (dx * sn + dy * c) / 0.5;
    return Math.max(0, 1 - u * u - v * v);
  };
  for (let y = 0; y < size; y++) {
    const fy = (y % rh) / rh - 0.5;
    for (let x = 0; x < size; x++) {
      const fx = (x % cw) / cw;
      const h = Math.max(lobe(fx - 0.27, fy, 0.5), lobe(fx - 0.73, fy, -0.5));
      out[y * size + x] = Math.sqrt(h) * 0.85 + noise[y * size + x] * 0.15;
    }
  }
  return out;
}
/** メタリック: 一方向に流れる細いヘアライン */
function brushedHeight(size: number) {
  const a = tileNoise(size, 256, 51);
  const b = tileNoise(size, 32, 52);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = a[y * size];
    for (let x = 0; x < size; x++) out[y * size + x] = row * 0.75 + a[y * size + x] * 0.1 + b[y * size + x] * 0.15;
  }
  return out;
}
/** ラバー: 細かい粒状の凹凸 */
function rubberHeight(size: number) {
  const a = tileNoise(size, 160, 71);
  const b = tileNoise(size, 40, 72);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const g = Math.min(1, Math.max(0, (a[i] - 0.45) * 4));
    out[i] = g * 0.6 + b[i] * 0.4;
  }
  return out;
}

export interface MaterialSpec {
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  normalScale: number;
  /** ノーマルマップの密度（1 単位あたりの繰り返し回数） */
  density: number;
  envMapIntensity: number;
}

export const MATERIAL_SPECS: Record<MaterialId, MaterialSpec> = {
  leather: { roughness: 0.5, metalness: 0, normalScale: 0.45, density: 2.2, envMapIntensity: 0.9 },
  suede: { roughness: 0.98, metalness: 0, sheen: 1, sheenRoughness: 0.75, normalScale: 0.35, density: 3, envMapIntensity: 0.5 },
  mesh: { roughness: 0.82, metalness: 0, normalScale: 1.4, density: 6, envMapIntensity: 0.6 },
  canvas: { roughness: 0.9, metalness: 0, normalScale: 0.8, density: 3, envMapIntensity: 0.55 },
  patent: { roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, normalScale: 0, density: 1, envMapIntensity: 1.3 },
  knit: { roughness: 0.88, metalness: 0, sheen: 0.6, sheenRoughness: 0.6, normalScale: 1.1, density: 2.2, envMapIntensity: 0.55 },
  metallic: { roughness: 0.3, metalness: 0.92, normalScale: 0.18, density: 2, envMapIntensity: 1.25 },
  rubber: { roughness: 0.72, metalness: 0, normalScale: 0.35, density: 3, envMapIntensity: 0.5 },
};

/** ツヤ（finish: -1 マット 〜 1 光沢）を加味した表面の粗さ・映り込み・クリアコート */
export function surfaceOf(style: Pick<PartStyle, 'material' | 'finish'>): { roughness: number; envMapIntensity: number; clearcoat: number } {
  const spec = MATERIAL_SPECS[style.material];
  const f = Math.max(-1, Math.min(1, style.finish ?? 0));
  const cc = spec.clearcoat ?? 0;
  if (f >= 0) {
    return {
      roughness: spec.roughness + (0.06 - spec.roughness) * f * 0.92,
      envMapIntensity: spec.envMapIntensity * (1 + 0.45 * f),
      clearcoat: Math.max(cc, f * 0.7),
    };
  }
  return {
    roughness: spec.roughness + (1 - spec.roughness) * -f,
    envMapIntensity: spec.envMapIntensity * (1 + 0.45 * f),
    clearcoat: cc * (1 + f),
  };
}

const normalCache = new Map<MaterialId, THREE.Texture | null>();
export function getNormalMap(m: MaterialId): THREE.Texture | null {
  if (normalCache.has(m)) return normalCache.get(m)!;
  const size = 512;
  let tex: THREE.Texture | null = null;
  const heights: Partial<Record<MaterialId, (n: number) => Float32Array>> = {
    leather: leatherHeight,
    suede: suedeHeight,
    mesh: meshHeight,
    canvas: canvasHeight,
    knit: knitHeight,
    metallic: brushedHeight,
    rubber: rubberHeight,
  };
  const h = heights[m]?.(size) ?? null;
  if (h) {
    const strength: Partial<Record<MaterialId, number>> = { mesh: 4, canvas: 5, suede: 3, knit: 4, metallic: 3, rubber: 5 };
    tex = new THREE.CanvasTexture(heightToNormal(h, size, strength[m] ?? 6));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.NoColorSpace;
  }
  normalCache.set(m, tex);
  return tex;
}

// ---------------- 柄 ----------------

/** 柄テクスチャ 1 枚が表す実寸（タイル 1 枚の大きさ） */
export const PATTERN_TILE: Record<PatternType, number> = { gradient: 0, camo: 1.6, check: 0.5, dot: 0.36, stripe: 0.5, splatter: 1.2, marble: 1.8 };

function drawGradient(colors: string[]) {
  const c = makeCanvas(4, 256);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 256, 0, 0); // v=0（下）→ v=1（上）
  const cs = colors.length > 1 ? colors : [colors[0], colors[0]];
  cs.forEach((col, i) => g.addColorStop(i / (cs.length - 1), col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return c;
}
function drawCheck(colors: string[]) {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const [a, b] = [colors[0], colors[1] ?? '#0E0E10'];
  const n = 4;
  const cell = s / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? b : a;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  return c;
}
function drawDot(colors: string[]) {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = colors[1] ?? '#0E0E10';
  const n = 4;
  const cell = s / n;
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      const ox = y % 2 ? cell / 2 : 0;
      ctx.beginPath();
      ctx.arc(x * cell + ox, y * cell, cell * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  return c;
}
function drawCamo(colors: string[]) {
  const s = 512;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  const cs = colors.length ? colors : ['#3F4A2A'];
  const rgb = cs.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const layers = [tileNoise(s, 6, 41), tileNoise(s, 12, 42), tileNoise(s, 9, 43)];
  const detail = tileNoise(s, 32, 44);
  for (let i = 0; i < s * s; i++) {
    let idx = 0;
    for (let L = 0; L < Math.min(layers.length, rgb.length - 1); L++) {
      if (layers[L][i] + (detail[i] - 0.5) * 0.18 > 0.56) idx = L + 1;
    }
    const col = rgb[idx];
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** ストライプ: 色を順に繰り返す。1 枚に (色数 × 2) 本。斜めは x+y で決めるので上下左右につながる */
function drawStripe(colors: string[], dir: PatternDirection) {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const cs = colors.length > 1 ? colors : [colors[0], '#0E0E10'];
  const n = cs.length * 2;
  if (dir === 'd') {
    const img = ctx.createImageData(s, s);
    const rgb = cs.map(hexRgb);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const col = rgb[Math.floor((((x + y) % s) / s) * n) % cs.length];
        const i = (y * s + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const w = s / n;
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = cs[k % cs.length];
    if (dir === 'v') ctx.fillRect(k * w, 0, w + 0.5, s);
    else ctx.fillRect(0, k * w, s, w + 0.5);
  }
  return c;
}
/** スプラッター: 地色の上に塗料のしぶき（大きな滴＋周りの細かい飛沫）。端をまたぐ滴は反対側にも描いてつなげる */
function drawSplatter(colors: string[]) {
  const s = 512;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, s, s);
  const inks = colors.length > 1 ? colors.slice(1) : ['#0E0E10'];
  const r = rng(81);
  const dot = (x: number, y: number, rad: number) => {
    for (const ox of [-s, 0, s])
      for (const oy of [-s, 0, s]) {
        if (x + ox + rad < 0 || x + ox - rad > s || y + oy + rad < 0 || y + oy - rad > s) continue;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
  };
  for (let k = 0; k < 70; k++) {
    ctx.fillStyle = inks[k % inks.length];
    const x = r() * s;
    const y = r() * s;
    const big = r() < 0.25;
    const rad = big ? 6 + r() * 10 : 1.5 + r() * 4;
    dot(x, y, rad);
    const drops = big ? 10 : 3;
    for (let j = 0; j < drops; j++) {
      const a = r() * Math.PI * 2;
      const d = rad * (1.2 + r() * 2.6);
      dot(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + r() * rad * 0.22);
    }
  }
  return c;
}
/** マーブル: 地色に流れる筋（ノイズで揺らした sin の山）。周期が整数なのでタイルできる */
function drawMarble(colors: string[]) {
  const s = 512;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  const base = hexRgb(colors[0]);
  const v1 = hexRgb(colors[1] ?? '#0E0E10');
  const v2 = hexRgb(colors[2] ?? colors[1] ?? '#6B6B73');
  const n1 = tileNoise(s, 4, 91);
  const n2 = tileNoise(s, 8, 92);
  const n3 = tileNoise(s, 16, 93);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      const turb = n1[i] * 1.0 + n2[i] * 0.5 + n3[i] * 0.25;
      const a = Math.abs(Math.sin(Math.PI * ((2 * x) / s + y / s + turb * 2.2)));
      const b = Math.abs(Math.sin(Math.PI * ((x / s) * 3 - (2 * y) / s + turb * 3.1)));
      const k1 = (1 - a) ** 10;
      const k2 = (1 - b) ** 16 * 0.7;
      const o = i * 4;
      for (let ch = 0; ch < 3; ch++) {
        const m = base[ch] + (v2[ch] - base[ch]) * k2;
        img.data[o + ch] = m + (v1[ch] - m) * k1;
      }
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}
function hexRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const patternCache = new Map<string, THREE.Texture>();
export function getPatternTexture(type: PatternType, colors: string[], direction: PatternDirection = 'h'): THREE.Texture {
  const key = type + '|' + colors.join(',') + (type === 'stripe' ? '|' + direction : '');
  let t = patternCache.get(key);
  if (t) return t;
  const canvas =
    type === 'gradient'
      ? drawGradient(colors)
      : type === 'check'
        ? drawCheck(colors)
        : type === 'dot'
          ? drawDot(colors)
          : type === 'stripe'
            ? drawStripe(colors, direction)
            : type === 'splatter'
              ? drawSplatter(colors)
              : type === 'marble'
                ? drawMarble(colors)
                : drawCamo(colors);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (type === 'gradient') t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  else t.wrapS = t.wrapT = THREE.RepeatWrapping;
  patternCache.set(key, t);
  if (patternCache.size > 40) {
    const first = patternCache.keys().next().value!;
    patternCache.get(first)?.dispose();
    patternCache.delete(first);
  }
  return t;
}

/** 地面の柔らかい影 */
let shadowTex: THREE.Texture | null = null;
export function getShadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 64, 4, 128, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.setTransform(2, 0, 0, 1, -128, 0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}
