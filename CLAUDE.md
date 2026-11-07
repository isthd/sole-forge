# SOLE FORGE — 開発メモ（Claude Code 用）

オフラインで動く PWA の「オリジナル・ハイカットスニーカー工房」。企画書は `docs/PLAN.md`、判断の記録は `docs/DECISIONS.md`、受け入れ結果は `docs/REPORT.md`。

## 技術スタック

React 18 + TypeScript + Vite 6 / Three.js 0.170 + @react-three/fiber 8 + drei 9 / Zustand 5 + zundo 2 / Dexie 4 (IndexedDB) / vite-plugin-pwa (Workbox) / Vitest 3 + Playwright

## ディレクトリ構成

```
src/
  models/            ベース型とデータモデル（3D 以外に依存しない）
    types.ts         企画書のデータモデル（PartId, PartStyle, Decal, SneakerDesign）
    design.ts        作品の生成・複製・左右ミラーなどの純粋関数
    baseModel.ts     ベース型の定義インターフェース（寸法パラメータ＋パーツ生成関数）
    sneakerBuilder.ts 共通のパーツ生成（寸法パラメータ → 10 パーツ）と defineSneaker()
    hightop01.ts     ベース型「ランナー 01」（ローカット・厚底。ID は互換のため hightop-01）
    hicut01.ts / midcut01.ts / lowtop01.ts / platform01.ts  ハイカット / ミッドカット / ローカット / 厚底ロー
                     各ベース型は寸法パラメータだけ。型の追加 = このようなファイルを 1 つ足す
    shape.ts         パーツの形の選択肢（トゥキャップ・サイドパネル・靴ひもなど）。作品の shape に保存
    reproject.ts     型・形の切り替え時にデカールを新しい表面へ載せ直す
    index.ts         ベース型の登録表（types.ts の BaseModelId / BASE_MODEL_IDS にも足す）と modelOf()（ベース型＋形の選択）
  renderers/
    three/           作品 → Three.js オブジェクト（SneakerView）、テクスチャ、デカール、オフスクリーン PNG
      fx/            制作過程の 3D 演出（塗り広げのシェーダー、スプレー缶、ステッカーの反りとヘラ、計算は processMath.ts）
    r3f/             @react-three/fiber の 3D ビュー（操作・カメラ）、DecalGizmo（選択中デカールの 3D ハンドル）
    logos.ts         付属のオリジナルロゴ・フォント定義
  store/             Zustand ストア（editorStore = 作品と Undo 履歴、appStore = 画面状態、persistence = 自動保存）
  db/                Dexie（db.ts）、CRUD（repo.ts）、JSON バックアップとマイグレーション（backup.ts）
  features/
    editor/          エディタ画面・各パネル・PNG 書き出しダイアログ
    shelf/           コレクション棚・3D ビューア
    settings/        設定画面
tests/               Vitest（モデル・ストア・DB）
e2e/                 Playwright（オフライン E2E と受け入れ基準）
scripts/gen-icons.mjs  アプリアイコン PNG の生成
```

## 守るルール

- **外部ネットワークへのリクエスト禁止**。フォント（@fontsource）・画像・テクスチャはすべて同梱かコードで生成する。drei の `Environment preset` や `Text`（CDN を読む）は使わない。環境光は `RoomEnvironment` をコードで生成
- **実在ブランドの形やロゴは使わない**。付属ロゴ・サイドパネル・アイコンもオリジナル（ストライプ 3 本や流線形のスウッシュ風の形は避ける）
- テクスチャは 1024px 以下、1 足（左右）5 万ポリゴン以下（現在 1 足片側 最大 24,744。形の組み合わせ込み）
- 3D の描画は `frameloop="demand"`（操作中だけ描画）。演出は動いている間だけ次のフレームを要求し、エディタ以外（サムネイル・書き出し・棚）では使わない
- UI: 背景 #0E0E10、アクセント #C6FF00、900px 未満はスマホレイアウト

## コマンド

- `npm run dev` — 開発サーバー
- `npm run build` — 型チェック＋本番ビルド（PWA の Service Worker も生成）
- `npm test` — Vitest（単体テスト）
- `npm run test:e2e` — ビルドして Playwright（`vite preview` に対してオフライン E2E）
- `npm run icons` — アイコン PNG を再生成

## 完了の定義

`npm run build` と `npm test` が通り、`npm run test:e2e`（オフライン E2E）が緑。
