import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * 制作過程の 3D 演出（スプレーで塗る・素材の張り替え・ヘラで貼る・はがす・3D ハンドル）。
 * 演出の状態は window.__sfFx.stats()（外部通信なし）で確かめる。
 */
const OUT = 'test-results/artifacts';
mkdirSync(OUT, { recursive: true });

interface Stats {
  paints: number;
  overlays: number;
  stickers: number;
  can: boolean;
  particles: number;
  ghost: boolean;
}

const stats = (page: Page): Promise<Stats | null> => page.evaluate(() => (window as any).__sfFx?.stats() ?? null);
const editor = (page: Page) => page.evaluate(() => (window as any).__sf.useEditor.getState());
const design = async (page: Page) => (await editor(page)).design;

async function waitReady(page: Page) {
  await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true && !!(window as any).__sf.useEditor.getState().design);
  await page.waitForSelector('[data-testid=viewport] canvas');
  await page.waitForFunction(() => !!(window as any).__sfFx);
  await page.waitForTimeout(400);
}

async function canvasPoint(page: Page, fx: number, fy: number) {
  const box = (await page.locator('[data-testid=viewport] canvas').first().boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function tapModel(page: Page, fx: number, fy: number) {
  const p = await canvasPoint(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** すべての演出が終わるまで待つ */
async function settle(page: Page) {
  await expect
    .poll(async () => {
      const s = await stats(page);
      return s ? s.paints + s.overlays + s.stickers + (s.can ? 1 : 0) + s.particles : 0;
    }, { timeout: 10_000 })
    .toBe(0);
}

async function drag(page: Page, from: { x: number; y: number }, to: (k: number) => { x: number; y: number }, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = to(i / steps);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
}

test.describe.serial('制作過程の 3D 演出', () => {
  test('色を変えるとスプレー缶が吹き付けて塗り広がり、素材の変更は継ぎ目が走って張り替わる', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const before = (await design(page)).id;
    await page.getByTestId('new-design').click();
    await expect.poll(async () => (await design(page)).id).not.toBe(before);
    await page.locator('[data-view=side]').click();
    await page.waitForTimeout(800);

    // モデルをタップしてパーツを選ぶ（タップした位置が塗りの起点になる）
    await tapModel(page, 0.45, 0.42);
    const part = (await editor(page)).selectedPart;
    const origin = await page.evaluate(() => (window as any).__sf.useApp.getState().paintOrigin);
    expect(origin?.part).toBe(part);

    await page.locator('[data-tab=color]').click();
    await page.locator('.swatch-grid .swatch-btn').nth(12).click(); // #FF2E2E
    expect((await design(page)).parts[part].color).toBe('#FF2E2E'); // データにはすぐ入る（演出は見た目だけ）
    await expect.poll(async () => {
      const s = await stats(page);
      return !!s && s.overlays > 0 && s.can;
    }).toBe(true);
    await expect.poll(async () => (await stats(page))!.particles).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/process-spray.png` });
    await settle(page);

    // 素材の張り替え: スプレー缶は出さず、塗り広げの層だけ
    await page.locator('[data-tab=material]').click();
    await page.locator('[data-material=suede]').click();
    await expect.poll(async () => (await stats(page))!.overlays).toBeGreaterThan(0);
    expect((await stats(page))!.can).toBe(false);
    await page.screenshot({ path: `${OUT}/process-material.png` });
    await settle(page);

    // ランダム配色: 複数のパーツを順に塗る
    await page.getByRole('button', { name: 'ランダム配色' }).click();
    await expect.poll(async () => (await stats(page))!.paints).toBeGreaterThan(2);
    await settle(page);
  });

  test('スプレーモード: 選んだ色で、タップしたパーツを塗る', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.locator('[data-view=side]').click();
    await page.waitForTimeout(800);
    await page.locator('.side.left [data-part=upper]').click();
    await page.locator('[data-tab=color]').click();
    await page.locator('.swatch-grid .swatch-btn').nth(8).click(); // #00B3FF
    await expect.poll(async () => (await stats(page))!.paints).toBeGreaterThan(0);
    await settle(page);
    await page.getByTestId('spray-mode').click();
    await expect(page.getByTestId('spray-banner')).toBeVisible();
    expect((await editor(page)).brushColor).toBe('#00B3FF');

    // アッパー以外のパーツ（横から見てミッドソール・アウトソールのあたり）に当たるまでタップする
    let sprayed: string | null = null;
    for (const [fx, fy] of [
      [0.5, 0.71],
      [0.5, 0.75],
      [0.35, 0.7],
      [0.5, 0.52],
    ]) {
      await tapModel(page, fx, fy);
      const p = (await editor(page)).selectedPart;
      if (p !== 'upper') {
        sprayed = p;
        break;
      }
    }
    expect(sprayed).not.toBeNull();
    expect((await design(page)).parts[sprayed!].color).toBe('#00B3FF');
    await expect.poll(async () => (await stats(page))!.overlays).toBeGreaterThan(0);
    await page.locator('.brand').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('spray-banner')).toHaveCount(0);
    await settle(page);
  });

  test('デカール: カーソルに半透明のプレビュー → ヘラで押し付けて貼る → 3D ハンドルで回転・拡大・移動 → はがす', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.locator('[data-view=side]').click();
    await page.waitForTimeout(800);
    await page.locator('[data-tab=decal]').click();
    await page.getByRole('tab', { name: 'ロゴ' }).click();
    await page.locator('[data-logo="logo:hex"]').click();
    await page.getByTestId('start-placing').click();
    const n0 = (await design(page)).decals.length;

    // カーソルの位置にプレビュー
    const p = await canvasPoint(page, 0.46, 0.45);
    await page.mouse.move(p.x - 20, p.y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect.poll(async () => (await stats(page))!.ghost).toBe(true);
    // タップで貼る（浮いた状態から押し付ける演出）
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await design(page)).decals.length).toBe(n0 + 1);
    await expect.poll(async () => (await stats(page))!.stickers).toBeGreaterThan(0);
    expect((await stats(page))!.ghost).toBe(false);
    await page.screenshot({ path: `${OUT}/process-sticker.png` });
    await settle(page);

    // 3D ハンドル（貼り終わってから出る）
    const sel = async () => {
      const s = await editor(page);
      return s.design.decals.find((d: any) => d.id === s.selectedDecalId);
    };
    await expect.poll(() => page.evaluate(() => !!(window as any).__sfFx.handles())).toBe(true);
    const cam0 = (await editor(page)).camera;
    const d0 = await sel();
    let h = await page.evaluate(() => (window as any).__sfFx.handles());
    // 回転ハンドル（上の丸）を中心のまわりに時計回りへ 45°
    const r = Math.hypot(h.rotate.x - h.center.x, h.rotate.y - h.center.y);
    const a0 = Math.atan2(h.rotate.y - h.center.y, h.rotate.x - h.center.x);
    await drag(page, h.rotate, (k) => ({ x: h.center.x + r * Math.cos(a0 + (k * Math.PI) / 4), y: h.center.y + r * Math.sin(a0 + (k * Math.PI) / 4) }));
    const d1 = await sel();
    expect(Math.abs(d1.rotation - (d0.rotation + 45))).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `${OUT}/process-gizmo.png` });

    // 拡大ハンドル（右下の四角）を中心から 1.5 倍の距離へ
    h = await page.evaluate(() => (window as any).__sfFx.handles());
    const sx = h.scale.x - h.center.x;
    const sy = h.scale.y - h.center.y;
    await drag(page, h.scale, (k) => ({ x: h.center.x + sx * (1 + 0.5 * k), y: h.center.y + sy * (1 + 0.5 * k) }));
    const d2 = await sel();
    expect(d2.scale / d1.scale).toBeGreaterThan(1.35);
    expect(d2.scale / d1.scale).toBeLessThan(1.65);

    // デカールそのものをドラッグして表面をなぞって移動
    h = await page.evaluate(() => (window as any).__sfFx.handles());
    await drag(page, h.center, (k) => ({ x: h.center.x + 70 * k, y: h.center.y - 10 * k }));
    const d3 = await sel();
    expect(d3.position).not.toEqual(d2.position);
    expect(d3.rotation).toBe(d1.rotation);
    // ハンドル操作の間はカメラが回っていない
    expect((await editor(page)).camera).toEqual(cam0);
    // 3 回の操作は 3 手として Undo できる
    await page.locator('.brand').click();
    await page.keyboard.press('Control+z');
    expect((await sel()).position).toEqual(d2.position);
    await page.keyboard.press('Control+Shift+z');

    // 削除するとめくれてはがれる
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await design(page)).decals.length).toBe(n0);
    await expect.poll(async () => (await stats(page))!.stickers).toBeGreaterThan(0);
    await settle(page);
    // Undo で戻すと貼り直す演出
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await design(page)).decals.length).toBe(n0 + 1);
    await expect.poll(async () => (await stats(page))!.stickers).toBeGreaterThan(0);
    await settle(page);
  });

  test('スマホ（タッチ）: 貼り付け待ちになると画面中央にプレビューが出て、タップで貼れる', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('/#/editor');
    await waitReady(page);
    await page.locator('.tabbar [data-tab=decal]').tap();
    await page.getByTestId('start-placing').tap();
    await expect.poll(async () => (await stats(page))!.ghost).toBe(true);
    const n0 = (await design(page)).decals.length;
    const box = (await page.locator('[data-testid=viewport] canvas').first().boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect.poll(async () => (await design(page)).decals.length).toBe(n0 + 1);
    await expect.poll(async () => (await stats(page))!.stickers).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/process-mobile-sticker.png` });
    await ctx.close();
  });

  test('設定で演出をオフにすると、変更はすぐ反映される（オンに戻せる）', async ({ page }) => {
    await page.goto('/#/settings');
    await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true);
    await page.getByTestId('fx-off').click();
    await expect(page.getByTestId('fx-off')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-nav=editor]').click();
    await page.waitForSelector('[data-testid=viewport] canvas');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__sfFx)).toBeUndefined();
    await page.locator('[data-tab=color]').click();
    await page.locator('.swatch-grid .swatch-btn').nth(14).click();
    expect((await design(page)).parts[(await editor(page)).selectedPart].color).toBe('#FFC400');
    // 再読み込みしてもオフのまま
    await page.reload();
    await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true);
    expect(await page.evaluate(() => (window as any).__sf.useApp.getState().processFx)).toBe(false);
    await page.locator('[data-nav=settings]').click();
    await page.getByTestId('fx-on').click();
    await page.locator('[data-nav=editor]').click();
    await waitReady(page);
  });
});
