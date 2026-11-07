import { test, expect, type Page, type BrowserContext, type Download } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = 'test-results/artifacts';
mkdirSync(OUT, { recursive: true });
const metrics: Record<string, unknown> = {};

// ---------- helpers ----------

/** 外部オリジンへのリクエストを記録する */
function trackRequests(ctx: BrowserContext, base: string) {
  const external: string[] = [];
  ctx.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  return external;
}

/** 初回アクセスで Service Worker が全アセットをプリキャッシュし、ページを制御するまで待つ */
async function primeServiceWorker(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__sf && document.querySelector('.topbar'));
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('SW not active');
  });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // プリキャッシュ完了（install 完了 = active）を確認
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    let n = 0;
    for (const k of keys) n += (await (await caches.open(k)).keys()).length;
    return n;
  });
  expect(cached).toBeGreaterThan(250);
  return cached;
}

const store = (page: Page) => ({
  design: () => page.evaluate(() => (window as any).__sf.useEditor.getState().design),
  camera: () => page.evaluate(() => (window as any).__sf.useEditor.getState().camera),
});

async function waitReady(page: Page, canvas = true) {
  await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true && !!(window as any).__sf.useEditor.getState().design);
  if (canvas) await page.waitForSelector('[data-testid=viewport] canvas');
  await page.waitForTimeout(400);
}

async function canvasPoint(page: Page, fx = 0.5, fy = 0.5) {
  const box = (await page.locator('[data-testid=viewport] canvas').first().boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** 3D ビュー上をタップ（クリック） */
async function tapModel(page: Page, fx = 0.5, fy = 0.5) {
  const p = await canvasPoint(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

function pngSize(file: string) {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

async function saveDownload(dl: Download, name: string) {
  const p = path.join(OUT, name);
  await dl.saveAs(p);
  return p;
}

// ---------- tests ----------

test.describe.serial('SOLE FORGE MVP 受け入れ', () => {
  let backupFile = '';
  let backupNames: string[] = [];

  test('[1][3][4][5][6][7] 機内モード相当（オフライン）で新規作成〜保存・書き出しまで全操作できる', async ({ page, context, baseURL }) => {
    const external = trackRequests(context, baseURL!);
    metrics.precachedEntries = await primeServiceWorker(page);

    // ---- オフラインにして再起動 ----
    await context.setOffline(true);
    await page.reload();
    await waitReady(page);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // フォント（同梱）がオフラインで読める
    const fonts = await page.evaluate(async () => {
      const a = await document.fonts.load('700 20px "Oswald"', 'SOLE FORGE');
      const b = await document.fonts.load('400 16px "Noto Sans JP"', 'スニーカー工房');
      const c = await document.fonts.load('400 20px "Permanent Marker"', 'FORGE');
      return [a.length, b.length, c.length];
    });
    expect(fonts.every((n) => n > 0)).toBe(true);

    // ---- 新規作成 ----
    const before = (await store(page).design()).id;
    await page.getByTestId('new-design').click();
    await expect.poll(async () => (await store(page).design()).id).not.toBe(before);

    // ---- [3] 10 パーツすべてに色・素材・柄 ----
    const parts = ['upper', 'toe', 'heel', 'eyestay', 'tongue', 'lining', 'sidePanel', 'midsole', 'outsole', 'laces'];
    const materials = ['leather', 'suede', 'mesh', 'canvas', 'patent', 'knit', 'metallic', 'rubber'];
    const patterns = ['gradient', 'camo', 'check', 'dot', 'stripe', 'splatter', 'marble'];
    for (let i = 0; i < parts.length; i++) {
      await page.locator(`.side.left [data-part=${parts[i]}]`).click();
      await page.locator('[data-tab=color]').click();
      await page.locator('.swatch-grid .swatch-btn').nth(6 + (i % 10)).click();
      await page.locator('[data-tab=material]').click();
      await page.locator(`[data-material=${materials[i % materials.length]}]`).click();
      await page.locator('[data-tab=pattern]').click();
      await page.locator(`[data-pattern=${patterns[i % patterns.length]}]`).click();
    }
    const d1 = await store(page).design();
    for (let i = 0; i < parts.length; i++) {
      expect(d1.parts[parts[i]].material).toBe(materials[i % materials.length]);
      expect(d1.parts[parts[i]].pattern.type).toBe(patterns[i % patterns.length]);
    }
    expect(new Set(parts.map((p) => d1.parts[p].color)).size).toBeGreaterThan(1);

    // ---- パーツの形・ツヤ・柄の大きさ ----
    await page.locator('.side.left [data-part=sidePanel]').click();
    await page.locator('[data-tab=shape]').click();
    await page.locator('[data-shape=sidePanel][data-value=saddle]').click();
    await page.locator('.side.left [data-part=laces]').click();
    await page.locator('[data-shape=laceWidth][data-value=thick]').click();
    await page.locator('[data-shape=eyelets][data-value="5"]').click();
    await page.locator('.side.left [data-part=toe]').click();
    await page.locator('[data-shape=toeCap][data-value=long]').click();
    await expect.poll(async () => (await store(page).design()).shape).toEqual({ toeCap: 'long', sidePanel: 'saddle', eyelets: '5', laceWidth: 'thick' });
    await page.screenshot({ path: `${OUT}/shape-options.png` });
    await page.locator('[data-tab=material]').click();
    await page.getByTestId('finish').fill('0.6');
    expect((await store(page).design()).parts.toe.finish).toBe(0.6);
    await page.locator('[data-tab=pattern]').click();
    await page.getByTestId('pattern-scale').fill('1.5');
    expect((await store(page).design()).parts.toe.pattern.scale).toBe(1.5);
    // 形は元に戻すで戻せる
    await page.locator('[data-tab=shape]').click();
    await page.getByRole('button', { name: '標準の形に戻す' }).click();
    expect((await store(page).design()).shape?.toeCap).toBeUndefined();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await store(page).design()).shape?.toeCap).toBe('long');

    // ---- [4] ロゴ・画像・文字をモデル表面に貼る ----
    await page.locator('[data-tab=decal]').click();
    await page.getByRole('tab', { name: 'ロゴ' }).click();
    await page.locator('[data-logo="logo:spark"]').click();
    await page.getByTestId('start-placing').click();
    await tapModel(page, 0.42, 0.45);
    await expect.poll(async () => (await store(page).design()).decals.length).toBe(1);

    await page.getByRole('tab', { name: '画像' }).click();
    await page.getByTestId('decal-image-input').setInputFiles('public/icon-192.png');
    await expect(page.locator('.image-preview')).toBeVisible();
    await page.getByTestId('start-placing').click();
    await tapModel(page, 0.55, 0.5);
    await expect.poll(async () => (await store(page).design()).decals.length).toBe(2);

    await page.getByRole('tab', { name: '文字' }).click();
    await page.getByLabel('貼る文字').fill('FORGE 01');
    await page.getByTestId('start-placing').click();
    await tapModel(page, 0.35, 0.38);
    await expect.poll(async () => (await store(page).design()).decals.length).toBe(3);
    const d2 = await store(page).design();
    expect(d2.decals.map((x: any) => x.kind).sort()).toEqual(['image', 'logo', 'text']);
    for (const dc of d2.decals) expect(dc.part).not.toBe('laces');

    // 移動・拡大・回転・反転・重ね順（最後に貼った文字が選択中）
    const textDecal = d2.decals.find((x: any) => x.kind === 'text');
    await expect(page.getByTestId('decal-editor')).toBeVisible();
    await page.getByRole('button', { name: '右へ' }).click();
    await expect.poll(async () => (await store(page).design()).decals.find((x: any) => x.id === textDecal.id).position).not.toEqual(textDecal.position);
    await page.getByLabel('大きさ').fill('0.9');
    await page.getByLabel('回転').fill('30');
    await page.getByRole('button', { name: '左右反転' }).click();
    await page.getByRole('button', { name: '最背面' }).click();
    let t = (await store(page).design()).decals.find((x: any) => x.id === textDecal.id);
    expect(t.scale).toBeCloseTo(0.9, 2);
    expect(t.rotation).toBe(30);
    expect(t.flip).toBe(true);
    expect(t.z).toBe(0);
    // ドラッグで移動（移動モード）
    const posBefore = t.position;
    await page.getByTestId('move-mode').click();
    const a = await canvasPoint(page, 0.4, 0.5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + k * 6, a.y - k * 3);
    await page.mouse.up();
    t = (await store(page).design()).decals.find((x: any) => x.id === textDecal.id);
    expect(t.position).not.toEqual(posBefore);
    await page.getByTestId('move-mode').click();

    // ---- [5] Undo/Redo 50 手以上 ----
    await page.locator('.side.left [data-part=upper]').click();
    await page.locator('[data-tab=color]').click();
    const startColor = (await store(page).design()).parts.upper.color;
    const sw = page.locator('.swatch-grid').first().locator('.swatch-btn');
    for (let i = 0; i < 55; i++) await sw.nth(i % 2 ? 1 : 12).click();
    const pastLen = await page.evaluate(() => (window as any).__sf.useEditor.temporal.getState().pastStates.length);
    expect(pastLen).toBeGreaterThanOrEqual(55);
    await page.locator('.brand').click();
    for (let i = 0; i < 55; i++) await page.keyboard.press('Control+z');
    expect((await store(page).design()).parts.upper.color).toBe(startColor);
    for (let i = 0; i < 55; i++) await page.keyboard.press('Control+Shift+z');
    expect((await store(page).design()).parts.upper.color).not.toBe(startColor);

    // 作品名を付けておく
    await page.getByLabel('作品名').fill('OFFLINE TEST');
    await page.locator('.brand').click();
    await page.waitForTimeout(800); // 自動保存

    // ---- [7] 単体 PNG（今の角度・透過・4x） ----
    await page.locator('[data-view=side]').click();
    await page.waitForTimeout(700);
    await page.getByTestId('open-export').click();
    await page.locator('.modal [data-scale="4"]').click();
    await page.locator('.modal [data-bg=transparent]').click();
    const [dl1] = await Promise.all([page.waitForEvent('download'), page.getByTestId('do-export').click()]);
    const single = pngSize(await saveDownload(dl1, 'single-4x.png'));
    expect(single.w).toBeGreaterThanOrEqual(4096);
    metrics.singlePng4x = single;
    // 背景あり 1x
    await page.getByTestId('open-export').click();
    await page.locator('.modal [data-scale="1"]').click();
    await page.locator('.modal [data-bg=dark]').click();
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('do-export').click()]);
    expect(pngSize(await saveDownload(dl2, 'single-1x-bg.png')).w).toBe(1024);

    // ---- [6] 棚: 並べ替え・複製・削除 → 再起動後も残る ----
    await page.locator('[data-nav=shelf]').click();
    await expect(page.getByTestId('shoe-card').first()).toBeVisible();
    // 2 足以上にする
    const count0 = await page.getByTestId('shoe-card').count();
    const cardOf = (name: string) => page.getByTestId('shoe-card').filter({ hasText: name });
    await cardOf('OFFLINE TEST').getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: '複製' }).click();
    await expect(page.getByTestId('shoe-card')).toHaveCount(count0 + 1);
    await expect(cardOf('OFFLINE TEST のコピー')).toHaveCount(1);
    // 並べ替え: コピーを前へ
    const namesBefore = await page.locator('[data-testid=shoe-card] .name').allTextContents();
    const idx = namesBefore.indexOf('OFFLINE TEST のコピー');
    await cardOf('OFFLINE TEST のコピー').getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: '前へ移動' }).click();
    await expect.poll(async () => (await page.locator('[data-testid=shoe-card] .name').allTextContents()).indexOf('OFFLINE TEST のコピー')).toBe(idx - 1);
    // さらに複製して 1 つ削除
    await cardOf('OFFLINE TEST のコピー').getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: '複製' }).click();
    await expect(page.getByTestId('shoe-card')).toHaveCount(count0 + 2);
    await cardOf('OFFLINE TEST のコピー のコピー').getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: '削除' }).click();
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('shoe-card')).toHaveCount(count0 + 1);
    // お気に入り
    await cardOf('OFFLINE TEST').first().getByRole('button', { name: 'お気に入りにする' }).click();
    const namesAfter = await page.locator('[data-testid=shoe-card] .name').allTextContents();

    // 選ぶと 3D で回せる
    await cardOf('OFFLINE TEST のコピー').locator('.thumb-btn').click();
    await expect(page.getByTestId('viewer').locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();

    // ---- [7] 棚全体 PNG 4x ----
    await page.locator('.page-head [data-scale="4"]').click();
    const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('export-shelf').click()]);
    const shelf = pngSize(await saveDownload(dl3, 'shelf-4x.png'));
    expect(shelf.w).toBeGreaterThan(1500);
    metrics.shelfPng4x = shelf;

    // 再起動（オフラインのまま）
    await page.reload();
    await waitReady(page, false);
    await page.locator('[data-nav=shelf]').click();
    await expect(page.getByTestId('shoe-card')).toHaveCount(count0 + 1);
    expect(await page.locator('[data-testid=shoe-card] .name').allTextContents()).toEqual(namesAfter);
    await expect(cardOf('OFFLINE TEST').first().getByRole('button', { name: 'お気に入りを外す' })).toBeVisible();

    // 編集内容も残っている
    await page.locator('[data-nav=editor]').click();
    await waitReady(page);

    // ---- [8 準備] JSON 書き出し ----
    await page.locator('[data-nav=settings]').click();
    const [dl4] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    backupFile = await saveDownload(dl4, 'backup.json');
    const json = JSON.parse(readFileSync(backupFile, 'utf8'));
    expect(json.app).toBe('sole-forge');
    expect(json.designs.length).toBe(count0 + 1);
    expect(Object.keys(json.blobs).some((k) => k.startsWith('img:'))).toBe(true);
    backupNames = json.designs.map((d: any) => d.name);

    // 外部への通信が 1 件もないこと
    expect(external, external.join('\n')).toEqual([]);
    await context.setOffline(false);
  });

  test('[8] JSON で書き出した全作品を別端末（新しいブラウザ）で読み込んで復元できる', async ({ browser, baseURL }) => {
    expect(backupFile).not.toBe('');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const external = trackRequests(ctx, baseURL!);
    const page = await ctx.newPage();
    await page.goto('/#/settings');
    await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true);
    await expect(page.getByTestId('design-count')).toHaveText('1 足'); // 新しい端末は初期作品 1 つ
    await page.getByTestId('import-json').setInputFiles(backupFile);
    await expect(page.locator('.toast')).toContainText('読み込みました');
    await page.locator('[data-nav=shelf]').click();
    const names = await page.locator('[data-testid=shoe-card] .name').allTextContents();
    for (const n of backupNames) expect(names).toContain(n);
    // 画像デカールも復元されている
    const restored = await page.evaluate(async () => {
      const req = indexedDB.open('sole-forge');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const tx = db.transaction('blobs');
      const keys: string[] = await new Promise((r) => {
        const q = tx.objectStore('blobs').getAllKeys();
        q.onsuccess = () => r(q.result as string[]);
      });
      return keys.filter((k) => k.startsWith('img:')).length;
    });
    expect(restored).toBeGreaterThan(0);
    // 復元した作品をエディタで開ける
    await page.getByTestId('shoe-card').filter({ hasText: 'OFFLINE TEST' }).first().getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: '編集する' }).click();
    await expect.poll(async () => (await store(page).design()).decals.length).toBe(3);
    expect(external).toEqual([]);
    await ctx.close();
  });

  test('[2] 3D ビューで回転・拡大・プリセット視点の切り替えができる', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const dist = (c: any) => Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
    // プリセット
    const presets: Record<string, number[]> = { front: [5.6, 1.4, 0], side: [0, 1.2, 5.6], back: [-5.6, 1.6, 0], top: [0.01, 6, 0.01] };
    for (const [k, v] of Object.entries(presets)) {
      await page.locator(`[data-view=${k}]`).click();
      await expect
        .poll(async () => {
          const c = await store(page).camera();
          return c ? Math.hypot(c.position[0] - v[0], c.position[1] - v[1], c.position[2] - v[2]) : 99;
        })
        .toBeLessThan(0.6);
    }
    await page.locator('[data-view=side]').click();
    await page.waitForTimeout(800);
    // ドラッグで回転
    const c0 = await store(page).camera();
    const p = await canvasPoint(page, 0.5, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + i * 20, p.y + i * 2);
    await page.mouse.up();
    await page.waitForTimeout(800);
    const c1 = await store(page).camera();
    expect(Math.abs(c1.position[0] - c0.position[0])).toBeGreaterThan(0.5);
    // ホイールで拡大
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
    await page.waitForTimeout(400);
    // 拡大はホイール後のドラッグ終了で保存されるため、少し回して確定させる
    await page.mouse.down();
    await page.mouse.move(p.x + 2, p.y);
    await page.mouse.up();
    await page.waitForTimeout(800);
    const c2 = await store(page).camera();
    expect(dist(c2)).toBeLessThan(dist(c1) - 0.3);
    // キーボード（1〜4）でも切り替え
    await page.locator('.brand').click();
    await page.keyboard.press('1');
    await expect.poll(async () => (await store(page).camera()).position[0]).toBeGreaterThan(5);
  });

  test('ベース型（ランナー / ハイカット / ミッドカット / ローカット / 厚底ロー）を選んで切り替えられる', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const tiles = page.locator('.side.left [data-model]');
    await expect(tiles).toHaveCount(5);
    await expect(page.locator('.side.left [data-model=hightop-01]')).toHaveAttribute('aria-checked', 'true');
    for (const id of ['hicut-01', 'midcut-01', 'lowtop-01', 'platform-01']) {
      await page.locator(`.side.left [data-model=${id}]`).click();
      await expect.poll(async () => (await store(page).design()).baseModel).toBe(id);
      await expect(page.locator(`.side.left [data-model=${id}]`)).toHaveAttribute('aria-checked', 'true');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/model-${id}.png` });
    }
    // 配色は引き継がれ、Undo で前の型に戻る
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await store(page).design()).baseModel).toBe('lowtop-01');
    // 保存され、再読み込みしても型が残る
    await page.waitForTimeout(800);
    await page.reload();
    await waitReady(page);
    expect((await store(page).design()).baseModel).toBe('lowtop-01');
    // 新規作成ボタンは今の型で作る
    await page.locator('[data-testid=new-design]').click();
    await expect.poll(async () => (await store(page).design()).name).toMatch(/#02/);
    expect((await store(page).design()).baseModel).toBe('lowtop-01');
  });

  test('[9] 幅 360px のスマホと 1440px の PC で操作が破綻しない', async ({ browser }) => {
    for (const vp of [
      { width: 360, height: 740, mobile: true },
      { width: 1440, height: 900, mobile: false },
    ]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
      const page = await ctx.newPage();
      for (const route of ['editor', 'shelf', 'settings']) {
        await page.goto('/#/' + route);
        await page.waitForFunction(() => (window as any).__sf?.useApp.getState().ready === true);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${vp.width}px ${route} の横はみ出し`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${OUT}/layout-${vp.width}-${route}.png` });
      }
      await page.goto('/#/editor');
      await waitReady(page);
      if (vp.mobile) {
        // 下部タブ → ボトムシート
        for (const tab of ['model', 'color', 'material', 'pattern', 'shape', 'decal', 'parts']) {
          await page.locator(`.tabbar [data-tab=${tab}]`).tap();
          await expect(page.locator('.sheet')).toBeVisible();
          const ov = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('.editor')!.scrollWidth) - window.innerWidth);
          expect(ov, `タブ ${tab} で横はみ出し`).toBeLessThanOrEqual(0);
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${OUT}/layout-360-tab-${tab}.png` });
        }
        // アクティブなタブをもう一度タップするとシートを閉じてビューを広く使える
        await page.locator('.tabbar [data-tab=parts]').tap();
        await expect(page.locator('.sheet')).toHaveCount(0);
        await page.locator('.tabbar [data-tab=color]').tap();
        await page.locator('.part-chips [data-part=toe]').tap();
        await page.locator('.sheet .swatch-btn').nth(9).tap();
        expect((await store(page).design()).parts.toe.color).toBe('#3A4BFF');
        // ビューが十分な大きさで見えている
        const box = (await page.locator('[data-testid=viewport]').boundingBox())!;
        expect(box.width).toBe(360);
        expect(box.height).toBeGreaterThan(200);
      } else {
        await expect(page.locator('.side.left')).toBeVisible();
        await expect(page.locator('.side.right')).toBeVisible();
      }
      // 回転の描画速度（カメラを回し続けて 3 秒間のフレーム数を数える）
      const fps = await page.evaluate(async () => {
        const w = window as any;
        w.__sfSpin = true;
        w.__sfInvalidate?.();
        await new Promise((r) => setTimeout(r, 600));
        const f0 = w.__sfFrames;
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, 3000));
        const fps = ((w.__sfFrames - f0) * 1000) / (performance.now() - t0);
        w.__sfSpin = false;
        return Math.round(fps * 10) / 10;
      });
      const gl = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const ext = c?.getExtension('WEBGL_debug_renderer_info');
        return ext ? c!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
      metrics[`fps_${vp.width}`] = { fps, renderer: gl, dpr: await page.evaluate(() => devicePixelRatio) };
      expect(fps, `${vp.width}px で回転 ${fps}fps (${gl})`).toBeGreaterThanOrEqual(30);
      await ctx.close();
    }
  });

  test('[9] スマホ相当の CPU（4 倍遅い）でも回転が 30fps 以上', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await page.goto('/#/editor');
    await waitReady(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const fps = await page.evaluate(async () => {
      const w = window as any;
      w.__sfSpin = true;
        w.__sfInvalidate?.();
      await new Promise((r) => setTimeout(r, 800));
      const f0 = w.__sfFrames;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 4000));
      const fps = ((w.__sfFrames - f0) * 1000) / (performance.now() - t0);
      w.__sfSpin = false;
      return Math.round(fps * 10) / 10;
    });
    metrics.fps_360_cpu4x = fps;
    expect(fps).toBeGreaterThanOrEqual(30);
    await ctx.close();
  });

  test.afterAll(() => {
    writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
  });
});
