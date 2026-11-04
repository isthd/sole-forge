import React from 'react';
import ReactDOM from 'react-dom/client';
// フォントはすべて同梱（@fontsource）。外部 CDN は使わない。
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/700.css';
import '@fontsource/permanent-marker/400.css';
import './styles.css';
import { App } from './App';
import { registerPWA } from './pwa';
import { useEditor } from './store/editorStore';
import { useApp } from './store/appStore';

// E2E テストとデバッグ用にストアを公開（外部通信はしない）
(window as unknown as { __sf: unknown }).__sf = { useEditor, useApp };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerPWA();
