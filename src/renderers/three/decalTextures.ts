import * as THREE from 'three';
import type { Decal } from '../../models/types';
import { DECAL_FONTS, getLogo } from '../logos';
import { getBlob } from '../../db/repo';
import { MAX_TEXTURE, makeCanvas } from './textures';

export interface DecalTex {
  texture: THREE.Texture;
  aspect: number; // 幅 / 高さ
}

export function decalContentKey(d: Pick<Decal, 'kind' | 'src' | 'text' | 'font' | 'color'>): string {
  return d.kind === 'image' ? `img|${d.src}` : d.kind === 'logo' ? `logo|${d.src}|${d.color}` : `text|${d.text}|${d.font}|${d.color}`;
}

async function ensureFont(family: string, weight: number) {
  try {
    await document.fonts.load(`${weight} 64px "${family}"`);
  } catch {
    /* フォント API が無い環境ではそのまま描く */
  }
}

async function drawDecalCanvas(d: Pick<Decal, 'kind' | 'src' | 'text' | 'font' | 'color'>): Promise<HTMLCanvasElement> {
  if (d.kind === 'logo') {
    const logo = getLogo(d.src);
    await ensureFont('Oswald', 700);
    const H = 512;
    const W = Math.min(MAX_TEXTURE, Math.round(H * logo.aspect));
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d')!;
    const k = Math.min(W / (100 * logo.aspect), H / 100);
    ctx.scale(k, k);
    logo.draw(ctx, d.color ?? '#FFFFFF');
    return c;
  }
  if (d.kind === 'text') {
    const fontDef = DECAL_FONTS.find((f) => f.id === d.font) ?? DECAL_FONTS[0];
    await ensureFont(fontDef.id, fontDef.weight);
    const text = (d.text ?? '').trim() || 'TEXT';
    const px = 160;
    const font = `${fontDef.weight} ${px}px "${fontDef.id}", "Noto Sans JP", sans-serif`;
    const probe = makeCanvas(8, 8).getContext('2d')!;
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 40;
    const h = Math.round(px * 1.35);
    const scale = Math.min(1, MAX_TEXTURE / w);
    const c = makeCanvas(Math.max(8, Math.round(w * scale)), Math.max(8, Math.round(h * scale)));
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.font = font;
    ctx.fillStyle = d.color ?? '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + px * 0.04);
    return c;
  }
  // 画像
  const blob = d.src ? await getBlob(d.src) : undefined;
  if (!blob) {
    const c = makeCanvas(64, 64);
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#C6FF00';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 56, 56);
    return c;
  }
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, MAX_TEXTURE / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

const cache = new Map<string, Promise<DecalTex>>();
export function getDecalTexture(d: Pick<Decal, 'kind' | 'src' | 'text' | 'font' | 'color'>): Promise<DecalTex> {
  const key = decalContentKey(d);
  let p = cache.get(key);
  if (!p) {
    p = drawDecalCanvas(d).then((canvas) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return { texture, aspect: canvas.width / canvas.height };
    });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 60) {
      const first = cache.keys().next().value!;
      cache.delete(first);
    }
  }
  return p;
}

/** 画像ファイルを 1024px 以下の PNG にして返す */
export async function normalizeImageFile(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_TEXTURE / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 変換に失敗'))), 'image/png'));
}
