# 使い方

ブラウザ上で 2D FEM を解いてマイクロストリップ線路の特性インピーダンス Z₀ を求めるツール。

## セットアップ

```bash
npm install
npm run dev          # http://localhost:5173 を開く
```

Node.js v20 LTS 以上必須。

## UI の使い方

左ペインのフォームに値を入れて、下のボタンを押す。

- **Calculate (Z₀ を計算)**: W, h, t, εr を入れる → FEM が Z₀ と ε_eff を返す。
- **Find W (W を探す)**: 目標 Z₀ と h, t, εr を入れる → 二分法でその Z₀ になる W を探す。

右ペインに

- 断面 + |E| ヒートマップ
- FEM の Z₀ / ε_eff
- Hammerstad–Jensen / Wheeler 公式値との比較表

が出る。単位は mm ↔ mil 切替可、UI は JA/EN 切替可(ヘッダ右上)。

## よく使うコマンド

```bash
npm run dev           # 開発サーバ
npm run test:run      # 単発テスト
npm run typecheck     # 型チェック
npm run build         # 本番ビルド (dist/)
npm run preview       # dist/ をプレビュー
```

## 想定外/未対応

損失・分散・差動ペア・CPW・多層基板は v0.1 では非対応(`CLAUDE.md §12` 参照)。

詳細は [README.md](./README.md) / [docs/](./docs/) を参照。
