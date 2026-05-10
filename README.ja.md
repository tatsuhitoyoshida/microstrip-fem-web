# microstrip-fem-web

マイクロストリップ線路の特性インピーダンス Z₀ を、ブラウザ上で
有限要素法 (FEM) により計算する Web ツール。

> **状態**: v0.2 — quasi-static FEM + Kirschning–Jansen 分散補正が
> 本番計算機(v0.1 経路、Hammerstad–Jensen と 2 % 以内一致)。さらに
> ベクトル全波 (Nédélec エッジ要素 + SC-PML 切り捨て) 固有値ソルバが
> **Full-wave (実験版)** ページに同梱。両経路とも end-to-end 検証済み。
> 全波経路を本番計算機に統合するために必要な作業(ILU(0) 前処理、
> V-P 多点直交)は [`docs/roadmap.md`](docs/roadmap.md) を参照。

[English README](./README.md)

## 何のためのツールか

既存の Web 計算ツールの多くは Hammerstad–Jensen 式や Wheeler 式といった
closed-form 近似に依存している。これらは薄導体・適度な W/h・quasi-TEM 動作
にチューニングされており、その範囲を外れると精度が黙って劣化する。本ツール
はブラウザ内で実際に PDE を解くため、精度はメッシュ(=こちらが制御できる)
で決まる。

## 機能

### メイン計算機(本番、v0.1 + v0.2 KJ 後処理)

- 線形 T3 要素による 2D quasi-static FEM。デフォルトで 1 解あたり ~50 k
  三角形
- メッシュ生成は [`triangle-wasm`](https://www.npmjs.com/package/triangle-wasm)
  (Shewchuk's Triangle の WebAssembly ポート)
- TypeScript 自前実装の Jacobi 前処理共役勾配法 sparse ソルバ
- forward 計算: 形状を入力 → Z₀, ε_eff, |E| ヒートマップ
- 逆設計: 目標 Z₀ を入力 → 二分法で W を逆算。f > 0 のときは
  Kirschning–Jansen 分散補正後の Z₀(f) をターゲットにするので、
  hero 値が指定値と一致する
- Hammerstad–Jensen / Wheeler との並列比較表
- Z₀(f) 周波数応答チャート (KJ 分散補正オーバーレイ)
- 断面プロットに導体・接地面・基板/空気界面を明示
- mm / mil 単位切替
- 日本語 / 英語 UI(URL プレフィックス `/ja/`, `/en/` で言語自動検出)
- 計算は全て Web Worker にオフロード、UI が固まらない
- Plotly は遅延ロード — 初回 JS payload は ~96 kB gzip

### Full-wave ページ(実験版、v0.2)

ヘッダの **Full-wave (実験版)** ボタンから到達。マイクロストリップ
断面のベクトル Helmholtz 固有値問題を SC-PML 切り捨て込みで解き、
β² を Maxwell から直接復元する。end-to-end 検証済み: ε_eff(FEM) が
f = 20 / 30 GHz の FR-4 で KJ 分散モデルと 0.3 % 以内一致。

- 混合 (E_t, E_z) Nédélec / nodal-Lagrange 定式
- 開境界の SC-PML 切り捨て
- 複素対称 Bi-CGSTAB 内側ソルバ + シフト・インバート外側固有値ソルバ
- ε_eff(f), Z₀ (V-P 定義), β² を KJ 参考値と並べて表示

本番計算機未統合の理由: Jacobi-PCG 内側ソルバが ~20 GHz 未満で停滞、
粗メッシュでの V-P Z₀ 抽出は KJ から ~30 % 上振れ。gating 作業は
[`docs/roadmap.md`](docs/roadmap.md)、定式化は
[`docs/theory.ja.md` §13](docs/theory.ja.md) を参照。

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
