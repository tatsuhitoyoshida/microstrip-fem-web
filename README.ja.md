# microstrip-fem-web

マイクロストリップ線路の特性インピーダンス Z₀ を、ブラウザ上で 2D 有限要素法 (FEM) により計算する Web ツール。

> **状態**: v0.1 開発中。全体ロードマップは [CLAUDE.md](./CLAUDE.md) を参照。

[English README](./README.md)

## なぜ FEM か

既存の Web 計算ツールの多くは Hammerstad-Jensen 式や Wheeler 式といった
closed-form 近似に依存しており、導体厚が厚い場合、h/W 比が小さい場合、高周波域
などで精度が劣化する。本ツールはブラウザ内で 2D quasi-static FEM を実行し、
これらの近似式が破綻する領域でも厳密な Z₀ を提供する。v0.1 はシングルエンドの
マイクロストリップのみを対象とし、差動ペア・CPW・ストリップラインは Phase 2 以降で対応する。

## クイックスタート

```bash
npm install
npm run dev      # Vite 開発サーバ起動
npm run test     # Vitest を watch モードで実行
npm run build    # dist/ に本番ビルド出力
```

Node.js は v20 LTS 以上が必要。

## 技術スタック

| 領域           | 採用                        |
| -------------- | --------------------------- |
| 言語           | TypeScript (strict)         |
| UI             | React 19                    |
| ビルド         | Vite                        |
| メッシュ       | `triangle-wasm`             |
| 線形ソルバ     | `eigen-js` (SimplicialLDLT) |
| 可視化         | Plotly.js                   |
| 国際化         | `react-i18next`             |
| 計算オフロード | Web Worker                  |
| テスト         | Vitest                      |
| ホスティング   | Cloudflare Pages            |

## プロジェクト構造

完全なプロジェクト構造・FEM 数式・フェーズ別開発計画は [CLAUDE.md](./CLAUDE.md)
に記載。理論解説と検証データは Phase 9 以降に `docs/` に配置する。

## ライセンス

MIT。[LICENSE](./LICENSE) を参照。

## コントリビュート

Issue / PR を歓迎する。提出前に [CLAUDE.md](./CLAUDE.md) を読み、特に v0.1 の
スコープ外項目を理解した上で提案してほしい。

---

[Photonic Edge Inc.](https://photonic-edge.com) が開発・公開
(`tools.photonic-edge.com`)。
