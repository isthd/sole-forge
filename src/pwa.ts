import { registerSW } from 'virtual:pwa-register';

/** Service Worker を登録。全アセットがプリキャッシュされ、初回アクセス以降はオフラインで動く。 */
export function registerPWA() {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onOfflineReady() {
      // 初回のプリキャッシュ完了
      document.documentElement.dataset.offlineReady = 'true';
    },
  });
}
