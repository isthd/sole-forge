# SOLE FORGE

**▶ アプリを開く: https://isthd.github.io/sole-forge/**（初回アクセス後はオフラインでも動きます）

オフラインで動く PWA の「オリジナル・ハイカットスニーカー工房」。3D で回しながら 10 パーツの色・素材・柄を変え、ロゴ・画像・文字を貼り、コレクション棚に飾って PNG で書き出せます。

- 3D モデルは Three.js のコードで手続き生成（外部モデルファイルなし、片足 24,584 ポリゴン）
- 初回アクセス後は完全オフライン（フォント含む全アセットを Service Worker でプリキャッシュ、外部通信なし）
- 作品は IndexedDB に自動保存、JSON でバックアップ／端末間移行
- 形・ロゴ・柄はすべてオリジナル（実在ブランドのシルエットやロゴは収録していません）

## 使い方

```bash
npm install
npm run dev        # 開発サーバー
npm run build      # 本番ビルド（PWA）
npm test           # 単体テスト（Vitest）
npm run test:e2e   # オフライン E2E（Playwright）
```

## 技術

React 18 + TypeScript + Vite / Three.js + @react-three/fiber + drei / Zustand + zundo / Dexie / vite-plugin-pwa / Vitest + Playwright

## ドキュメント

- [docs/PLAN.md](docs/PLAN.md) — 企画書
- [docs/DECISIONS.md](docs/DECISIONS.md) — 実装時の判断の記録
- [docs/REPORT.md](docs/REPORT.md) — 受け入れ基準 9 項目の結果
- [CLAUDE.md](CLAUDE.md) — ディレクトリ構成と開発ルール
