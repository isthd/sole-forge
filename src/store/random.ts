import type { MaterialId, PartId, PartStyle, PatternType } from '../models/types';
import { PART_IDS } from '../models/types';

/** 再現できる乱数（mulberry32） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}

type Scheme = 'mono' | 'analogous' | 'complement' | 'triad' | 'neutralPop';

/** 配色理論ベースのランダム配色。パーツの役割ごとに明度を変えてまとまりを出す。 */
export function randomParts(seed = Date.now()): Record<PartId, PartStyle> {
  const r = rng(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const base = r() * 360;
  const scheme: Scheme = pick(['mono', 'analogous', 'complement', 'triad', 'neutralPop'] as const);
  const hues: number[] =
    scheme === 'mono'
      ? [base, base, base]
      : scheme === 'analogous'
        ? [base, base + 30, base - 30]
        : scheme === 'complement'
          ? [base, base + 180, base]
          : scheme === 'triad'
            ? [base, base + 120, base + 240]
            : [base, base, base];
  const sat = 0.45 + r() * 0.5;
  const neutralDark = r() < 0.5;
  const neutral = (l: number) => hslToHex(base, 0.06, l);

  const main = scheme === 'neutralPop' ? neutral(neutralDark ? 0.12 : 0.92) : hslToHex(hues[0], sat, 0.3 + r() * 0.35);
  const accent = hslToHex(hues[1], Math.min(1, sat + 0.2), 0.5 + r() * 0.15);
  const third = hslToHex(hues[2], sat * 0.8, 0.2 + r() * 0.6);
  const soleLight = r() < 0.65;

  const materials: MaterialId[] = ['leather', 'suede', 'mesh', 'canvas', 'patent'];
  const mat = (fallback: MaterialId): MaterialId => (r() < 0.35 ? pick(materials) : fallback);

  const out: Record<PartId, PartStyle> = {
    upper: { color: main, material: mat('leather') },
    toe: { color: r() < 0.5 ? main : third, material: mat('leather') },
    heel: { color: r() < 0.5 ? accent : third, material: mat('suede') },
    eyestay: { color: third, material: mat('leather') },
    tongue: { color: r() < 0.5 ? main : neutral(0.9), material: mat('mesh') },
    lining: { color: r() < 0.5 ? accent : neutral(0.15), material: 'canvas' },
    sidePanel: { color: accent, material: mat('leather') },
    midsole: { color: soleLight ? neutral(0.93) : neutral(0.12), material: 'leather' },
    outsole: { color: r() < 0.5 ? neutral(0.1) : third, material: 'leather' },
    laces: { color: r() < 0.5 ? neutral(0.95) : accent, material: 'canvas' },
  };
  // ときどき柄を入れる
  if (r() < 0.35) {
    const target = pick(['sidePanel', 'upper', 'heel', 'toe'] as const);
    const type: PatternType = pick(['gradient', 'camo', 'check', 'dot'] as const);
    const colors = type === 'camo' ? [main, accent, third, neutral(0.2)] : [out[target].color, type === 'gradient' ? accent : third];
    out[target] = { ...out[target], pattern: { type, colors } };
  }
  for (const id of PART_IDS) if (!out[id]) throw new Error('missing ' + id);
  return out;
}
