/**
 * 付属ロゴ。すべて SOLE FORGE オリジナルの図形（実在ブランドのマークは収録しない）。
 * 100×100 の座標系で Canvas に描く。
 */
export interface LogoDef {
  id: string;
  label: string;
  aspect: number; // 幅 / 高さ
  draw: (ctx: CanvasRenderingContext2D, color: string) => void; // 100*aspect × 100 の座標系
}

function starPath(cx: number, cy: number, points: number, rOut: number, rIn: number, rot = -Math.PI / 2) {
  const p = new Path2D();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function hexPath(cx: number, cy: number, r: number) {
  const p = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

export const LOGOS: LogoDef[] = [
  {
    id: 'logo:hex',
    label: 'ヘックス SF',
    aspect: 1,
    draw: (ctx, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.stroke(hexPath(50, 50, 44));
      ctx.fillStyle = color;
      ctx.font = '700 46px "Oswald", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SF', 50, 53);
    },
  },
  {
    id: 'logo:spark',
    label: 'スパーク',
    aspect: 1,
    draw: (ctx, color) => {
      ctx.fillStyle = color;
      ctx.fill(starPath(50, 50, 8, 48, 18));
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(50, 50, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'logo:anvil',
    label: 'アンビル',
    aspect: 1.3,
    draw: (ctx, color) => {
      ctx.fillStyle = color;
      const p = new Path2D(
        'M8 26 H96 C110 26 122 22 126 14 C124 34 110 44 92 46 V58 C92 63 97 66 104 68 V80 H26 V68 C33 66 38 63 38 58 V48 C22 46 11 38 8 26 Z',
      );
      ctx.fill(p);
      ctx.fillRect(20, 86, 90, 8);
    },
  },
  {
    id: 'logo:bolt',
    label: 'ボルトリング',
    aspect: 1,
    draw: (ctx, color) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(50, 50, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill(new Path2D('M57 12 L27 55 H47 L40 88 L74 42 H54 L62 12 Z'));
    },
  },
  {
    id: 'logo:eye',
    label: 'アイ',
    aspect: 1.4,
    draw: (ctx, color) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 7;
      ctx.stroke(new Path2D('M6 50 C34 12 106 12 134 50 C106 88 34 88 6 50 Z'));
      ctx.beginPath();
      ctx.arc(70, 50, 17, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'logo:wordmark',
    label: 'ワードマーク',
    aspect: 3.2,
    draw: (ctx, color) => {
      ctx.fillStyle = color;
      ctx.font = '700 64px "Oswald", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SOLE FORGE', 160, 44);
      ctx.fillRect(14, 82, 292, 8);
    },
  },
];

export function getLogo(id: string | undefined): LogoDef {
  return LOGOS.find((l) => l.id === id) ?? LOGOS[0];
}

/** デカールで使えるフォント（すべて同梱） */
export const DECAL_FONTS = [
  { id: 'Oswald', label: 'Oswald（コンデンス）', weight: 700 },
  { id: 'Noto Sans JP', label: 'Noto Sans JP', weight: 700 },
  { id: 'Permanent Marker', label: 'Permanent Marker', weight: 400 },
] as const;
