# microstrip-fem-web

マイクロストリップ線路の特性インピーダンス Z₀ を、ブラウザ上で 2D
quasi-static 有限要素法 (FEM) により計算する Web ツール。

> **状態**: v0.1 — 機能は完成済み。HFSS / CST 外部検証と Photonic Edge
> コーポレートデザイン適用を経て `tools.photonic-edge.com` で公開予定。

[English README](./README.md)

## 何のためのツールか

既存の Web 計算ツールの多くは Hammerstad–Jensen 式や Wheeler 式といった
closed-form 近似に依存している。これらは薄導体・適度な W/h・quasi-TEM 動作
にチューニングされており、その範囲を外れると精度が黙って劣化する。本ツール
はブラウザ内で実際に PDE を解くため、精度はメッシュ(=こちらが制御できる)
で決まる。

## 機能 (v0.1)

- 線形 T3 要素による 2D quasi-static FEM。デフォルトで 1 解あたり ~50 k
  三角形
- メッシュ生成は [`triangle-wasm`](https://www.npmjs.com/package/triangle-wasm)
  (Shewchuk's Triangle の WebAssembly ポート)
- TypeScript 自前実装の Jacobi 前処理共役勾配法 sparse ソルバ
- forward 計算: 形状を入力 → Z₀, ε_eff, |E| ヒートマップ
- 逆設計: 目標 Z₀ を入力 → 二分法で W を逆算
- Hammerstad–Jensen / Wheeler との並列比較表
- 断面プロットに導体・接地面・基板/空気界面を明示
- mm / mil 単位切替
- 日本語 / 英語 UI(URL プレフィックス `/ja/`, `/en/` で言語自動検出)
- 計算は全て Web Worker にオフロード、UI が固まらない
- Plotly は遅延ロード — 初回 JS payload は ~88 kB gzip

## クイックスタート

```bash
npm install
npm run dev          # http://localhost:5173 で Vite 開発サーバ起動
npm run test:run     # Vitest 全件実行
npm run typecheck    # tsc -b --noEmit
npm run build        # dist/ に本番ビルド
npm run preview      # http://localhost:4173 で dist/ を配信
```

Node.js は v20 LTS 以上が必要。

## 技術スタック

| 領域           | 採用                                                 |
| -------------- | ---------------------------------------------------- |
| 言語           | TypeScript (strict, `noUncheckedIndexedAccess`)      |
| UI             | React 19                                             |
| ビルド         | Vite + Rolldown                                      |
| メッシュ       | `triangle-wasm`                                      |
| sparse ソルバ  | 自作 CG + Jacobi 前処理 (`src/fem/solver.ts`)        |
| 可視化         | `plotly.js-dist-min`(遅延ロード)                     |
| 国際化         | `react-i18next` + `i18next-browser-languagedetector` |
| 計算オフロード | Web Worker (`src/workers/femWorker.ts`)              |
| テスト         | Vitest + Testing Library                             |
| ホスティング   | Cloudflare Pages                                     |

## ドキュメント

- **[`docs/theory.ja.md`](./docs/theory.ja.md)** — FEM モデル、弱形式、
  T3 要素、境界条件、容量抽出、なぜ CG で Cholesky じゃないのか、v0.1
  で意図的にやらないこと
- **[`docs/architecture.md`](./docs/architecture.md)** — モジュールマップ、
  データフロー、ビルド chunk サイズ、テスト戦略(英語のみ)
- **[`docs/validation.md`](./docs/validation.md)** — 自動検証(closed-form
  / 教科書値との一致)+ HFSS/CST 手動検証用プレースホルダ表(英語のみ)
- **[`docs/deployment.md`](./docs/deployment.md)** — Cloudflare Pages
  立ち上げ、カスタムドメイン設定、ロールバック(英語のみ)
- **[`CLAUDE.md`](./CLAUDE.md)** — 当初の設計仕様書とフェーズ別開発計画

## プロジェクト構造

```
src/
├── analytical/   # Wheeler / Hammerstad–Jensen 解析公式
├── components/   # ParameterForm, ResultsPanel, ComparisonTable, CrossSectionPlot, About, LanguageSwitcher
├── fem/          # geometry, mesh, assembly, boundary, solver, capacitance, tlanalysis, sparse, constants
├── hooks/        # useMicrostripCalc(Worker を駆動)
├── i18n/         # i18next 設定 + ja / en locale JSON
├── lib/          # mm/mil 単位変換
├── optimization/ # bisection
├── types/        # 共有型 + ambient module 宣言
├── workers/      # femWorker entrypoint + メッセージ規約
└── App.tsx, main.tsx
public/
└── triangle.out.wasm
docs/
├── theory.md, theory.ja.md
├── architecture.md
├── validation.md
└── deployment.md
tests/
└── analytical.test.ts, geometry.test.ts, mesh.test.ts,
    parallel-plate.test.ts, microstrip.test.ts, bisection.test.ts,
    sparse.test.ts, solver.test.ts, units.test.ts,
    components.smoke.test.tsx
```

## ライセンス

MIT。[LICENSE](./LICENSE) を参照。

## コントリビュート

Issue / PR を歓迎する。本格的な PR を提出する前に
[CLAUDE.md](./CLAUDE.md) — 特に §12 (v0.1 スコープ外項目) と
§16 (進め方) を読んでほしい。closed-form と教科書値のテストは FEM パイプ
ライン変更時のリグレッション基準として機能する。

---

[Photonic Edge Inc.](https://photonic-edge.com) が開発・公開
(`tools.photonic-edge.com`)。
