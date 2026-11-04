import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: 本番ビルド (vite preview) に対して実行する。
 * `npm run test:e2e` はビルドしてから実行する。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 360_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    launchOptions: {
      // 実機の GPU を使って描画性能を測る（使えない環境では自動でソフトウェア描画になる）
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
