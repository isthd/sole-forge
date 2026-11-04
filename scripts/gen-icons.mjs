// オリジナルのアプリアイコン（SVG）を Playwright の Chromium で PNG に書き出す。
// 実行: npm run icons （生成物は public/ に同梱済み。デザイン変更時だけ再実行）
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const icon = (size, maskable) => {
  const pad = maskable ? size * 0.14 : 0;
  const s = size - pad * 2;
  return `<!doctype html><html><body style="margin:0;background:#0E0E10">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.2}" fill="#0E0E10"/>
  <g transform="translate(${pad} ${pad}) scale(${s / 100})">
    <path d="M10 66 V36 l18 4 11 10 h12 l22 7 15 9 2 5 v5 H10z" fill="#C6FF00"/>
    <path d="M30 54 l5 -6 h24 l5 6 l-5 6 h-24z" fill="#0E0E10"/>
    <circle cx="33" cy="42" r="2.4" fill="#0E0E10"/><circle cx="42" cy="49" r="2.4" fill="#0E0E10"/>
    <rect x="8" y="72" width="84" height="9" rx="3" fill="#F2F2EE"/>
    <rect x="8" y="81" width="84" height="5" rx="2" fill="#6B6B73"/>
  </g>
</svg></body></html>`;
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(icon(size, maskable));
  writeFileSync(`public/${name}`, await page.screenshot({ omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', name);
}
await browser.close();
