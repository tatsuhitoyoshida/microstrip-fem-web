# microstrip-fem-web — 開発仕様書 (v0.1)

このドキュメントは、Claude Codeがこのプロジェクトを開発する際の主たる指示書です。設計判断の根拠と具体的な実装ガイドラインを含みます。常にこのドキュメントを参照し、不明点があれば実装前にユーザに確認してください。

---

## 1. プロジェクト概要

**目的**: マイクロストリップ線路の特性インピーダンス Z₀ をブラウザ上で2D FEM(有限要素法)を用いて厳密に計算し、目標 Z₀ に対する最適な線幅 W を求めるWebツールを公開する。

**公開主体**: 株式会社 Photonic Edge(`tools.photonic-edge.com`)

**ライセンス**: MIT(public GitHub repo: `photonic-edge/microstrip-fem-web`)

**差別化メッセージ**: 既存の web 計算ツールは Hammerstad-Jensen 式や Wheeler 式の closed-form 計算がほとんどで、厚導体・低 h/W 比・高周波域などで精度が劣化する。本ツールはブラウザ上で 2D FEM を実行することで、これらの限界を超えた厳密値を提供する。

**スコープ**: v0.1 はシングルエンドのマイクロストリップ線路のみ。差動ペア・CPW・ストリップラインなどは将来の Phase 2 以降に拡張する設計とする。

---

## 2. 設計方針(なぜ FEM か)

Hammerstad-Jensen / Wheeler 式の限界:

- 導体厚 t が無視されているか、近似補正のみ
- 高周波における分散効果(quasi-TEM 仮定の破綻)
- 多層基板・カバー有り・隣接配線の影響
- 表皮効果・誘電体損失込みの complex Z₀ には別途近似が必要

これらに対し、2D 断面の quasi-static FEM は:

- 任意の断面形状を扱える
- 導体厚 t を厳密に考慮できる
- 多層構造への拡張が直接的
- v0.1 では quasi-static 近似(損失なし、分散なし)で公開し、v0.2 以降で全波解析・損失モデルへ拡張する

**FDTDではなくFEMを選択する理由**: 伝送線路断面解析は静的な楕円型問題であり、FEMの不規則メッシュが断面形状と特異点(導体エッジ)に最も適合する。FDTDは時間進行が必要で、本問題には不向き。

---

## 3. 技術スタック(決定済み)

| 領域              | 採用                                                           |
| ----------------- | -------------------------------------------------------------- |
| 言語              | TypeScript(strict mode)                                        |
| UI フレームワーク | React 18                                                       |
| ビルドツール      | Vite                                                           |
| メッシュ生成      | `triangle-wasm`(Triangle の WebAssembly ポート)                |
| 線形ソルバ        | `eigen-js`(Eigen の WebAssembly ポート、SimplicialLDLT を使用) |
| FEM 組立          | TypeScript で自作                                              |
| 可視化            | Plotly.js(電界ヒートマップ・スイープ曲線)                      |
| 国際化            | `react-i18next`(JA/EN bilingual)                               |
| 計算オフロード    | Web Worker(メインスレッドをブロックしない)                     |
| テスト            | Vitest                                                         |
| Lint/Format       | ESLint + Prettier                                              |
| デプロイ          | Cloudflare Pages(無料枠で十分)                                 |

ライブラリ選定の意図:

- `triangle-wasm`: 任意ポリゴン領域のDelaunay三角分割に対応。将来CPW/ストリップラインに拡張する際にも同じツールで対応可能
- `eigen-js`: スパース対称正定値行列に対する SimplicialLDLT は本問題に最適。10k 自由度クラスでミリ秒オーダーの解
- 自作FEM: 線形三角要素の組立は数百行で書ける。教育的価値・ブログ記事化・拡張性のため自作する

---

## 4. リポジトリ構成

```
microstrip-fem-web/
├── README.md                    # English
├── README.ja.md                 # 日本語
├── LICENSE                      # MIT
├── CLAUDE.md                    # このファイル
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
├── index.html
├── public/
│   └── favicon.svg
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ParameterForm.tsx       # 入力フォーム
│   │   ├── ResultsPanel.tsx        # 結果表示
│   │   ├── CrossSectionPlot.tsx    # 断面+電界可視化
│   │   ├── ComparisonTable.tsx     # FEM vs Wheeler/Hammerstad
│   │   ├── LanguageSwitcher.tsx
│   │   └── About.tsx
│   ├── fem/
│   │   ├── geometry.ts             # ジオメトリ→ポリゴンPSLG変換
│   │   ├── mesh.ts                 # triangle-wasmラッパ
│   │   ├── assembly.ts             # 要素剛性・全体剛性組立
│   │   ├── solver.ts               # eigen-jsラッパ
│   │   ├── capacitance.ts          # 容量抽出
│   │   └── tlanalysis.ts           # Z₀, ε_eff 計算
│   ├── analytical/
│   │   ├── wheeler.ts              # Wheeler式
│   │   └── hammerstad.ts           # Hammerstad-Jensen式
│   ├── optimization/
│   │   └── bisection.ts            # Z₀=target → W 探索
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── ja.json
│   │       └── en.json
│   ├── workers/
│   │   └── femWorker.ts            # FEM計算をWorkerで実行
│   ├── types/
│   │   └── index.ts                # 型定義集約
│   └── styles/
│       └── globals.css
├── tests/
│   ├── analytical.test.ts          # 解析式の妥当性
│   ├── mesh.test.ts                # メッシュ生成の妥当性
│   ├── assembly.test.ts            # 既知小問題でのFEM検証
│   ├── capacitance.test.ts         # 容量計算の妥当性
│   └── validation/
│       └── reference.test.ts       # HFSS/CST/教科書値との照合
└── docs/
    ├── theory.md                   # FEM理論解説(EN)
    ├── theory.ja.md                # FEM理論解説(JA)
    ├── validation.md               # 検証データ集
    ├── architecture.md             # アーキテクチャ
    └── deployment.md               # デプロイ手順
```

---

## 5. アーキテクチャ

### データフロー

```
User Input (W, h, t, εr, target Z₀)
        │
        ▼
ParameterForm.tsx
        │
        ▼
femWorker.ts (Web Worker)
        │
        ├─ geometry.ts: 入力 → PSLG ポリゴン
        ├─ mesh.ts: triangle-wasm 呼び出し → 三角メッシュ
        ├─ assembly.ts: 全体剛性行列 K 組立
        ├─ solver.ts: K φ = b を eigen-js で解く
        ├─ capacitance.ts: φ から C, C₀ 抽出
        ├─ tlanalysis.ts: C, C₀ → Z₀, ε_eff
        └─ bisection.ts: Z₀(W) = Z₀_target を満たす W を探索
        │
        ▼
ResultsPanel.tsx + CrossSectionPlot.tsx
```

### コンポーネント構造

`App.tsx` がトップレベル。左ペインに `ParameterForm`、右ペインに `CrossSectionPlot`(上)と `ResultsPanel`+`ComparisonTable`(下)を配置。`LanguageSwitcher` は右上ヘッダ。モバイルでは縦並びに崩す。

---

## 6. 開発フェーズ

各フェーズの完了基準を満たしてから次へ進むこと。各フェーズの最後にユーザに進捗を報告し、確認を得ること。

### Phase 0: プロジェクト初期化(1-2日)

- [ ] `npm create vite@latest` で React + TypeScript プロジェクト作成
- [ ] ESLint + Prettier 設定
- [ ] Vitest 導入
- [ ] MIT LICENSE 作成(Copyright (c) 2026 Photonic Edge Inc.)
- [ ] README skeleton(EN/JA)
- [ ] `.gitignore`(`node_modules`, `dist`, `.DS_Store` など)
- [ ] 初回コミット可能な状態

**完了基準**: `npm run dev` でデフォルト Vite ページが表示される。

### Phase 1: 解析公式の実装(2-3日)

ベースラインかつ UI のフォールバック値として最初に実装する。FEM ができる前から UI が動かせる。

- [ ] `analytical/wheeler.ts`: Wheeler の式で Z₀(W, h, εr, t) を計算
- [ ] `analytical/hammerstad.ts`: Hammerstad-Jensen の式で Z₀ と ε_eff を計算
- [ ] 教科書の参照値(下記検証セクション参照)に対する単体テスト

**完了基準**: 50 Ω@FR-4(εr=4.4, h=1.6mm)で W ≈ 3.0mm が ±2% 以内で得られる。

### Phase 2: メッシュ生成(3-5日)

- [ ] `triangle-wasm` を依存追加・WASM ロード処理
- [ ] `geometry.ts`: マイクロストリップ断面のパラメータ → PSLG(点・線分・領域マーカ・穴)変換
  - 外側計算領域: 基板幅の 10〜20倍、基板厚の 10〜20倍を上空に確保
  - 接地面: 領域下端
  - 基板: εr 領域マーカ
  - 導体: 矩形(W × t)を「穴」として扱い、その境界を Dirichlet境界とする
- [ ] `mesh.ts`: triangle-wasm 呼び出しラッパ。最大面積制約・最小角度制約を指定
- [ ] 導体エッジ近傍の局所細分化(adaptive refinement)
- [ ] デバッグ用メッシュ可視化機能(Plotly.js でメッシュエッジを描画)

**完了基準**: 標準的な microstrip 形状でクオリティの高いメッシュ(最小角度 ≥ 25°)が生成され、導体エッジ周辺が密になっていることを目視確認。

### Phase 3: FEM コア実装(5-7日)

- [ ] `assembly.ts`: 線形三角要素(T3)の要素剛性行列を実装
  - 要素 e の頂点 (x_i, y_i)、面積 A_e、形状関数の勾配 b_i, c_i から
  - K^e\_{ij} = (ε_e / 4A_e) · (b_i b_j + c_i c_j)
- [ ] 全体剛性行列 K の組立(スパース行列、CSR/COO 形式)
- [ ] Dirichlet 境界条件の適用(導体ノード φ=1V、接地面 φ=0、外部境界 φ=0)
- [ ] `solver.ts`: eigen-js の SimplicialLDLT で連立方程式を解く
- [ ] 既知解との照合: 平行平板コンデンサ(解析解 C = εA/d)で精度検証

**完了基準**: 平行平板コンデンサ問題で 1% 以内の誤差で C が再現される。

### Phase 4: 容量・伝送線路パラメータ抽出(3-5日)

- [ ] `capacitance.ts`: エネルギー法 W_e = (1/2) φ^T K φ から C = 2W_e / V² を計算
- [ ] εr ありで C、ε=1 で C₀(L = μ₀ε₀ / C₀)を計算
- [ ] `tlanalysis.ts`: Z₀ = √(L/C) = 1/(c √(C·C₀))、ε_eff = C/C₀
- [ ] Phase 1 の解析式との比較(薄導体・標準形状で 2% 以内一致)

**完了基準**: 標準的な microstrip 形状で Hammerstad 式と 2% 以内、HFSS 結果と 1% 以内で Z₀ が一致。

### Phase 5: 最適化(1-2日)

- [ ] `bisection.ts`: 二分法で Z₀(W) = Z₀_target を満たす W を探索
- [ ] 初期範囲は Hammerstad 式の解の周辺(0.5×〜2×)で限定
- [ ] 収束判定: |Z₀ - Z₀_target| < 0.05 Ω

**完了基準**: 50 Ω 目標で W が 0.05 Ω 精度で求まる。

### Phase 6: UI 実装(5-7日)

- [ ] `ParameterForm.tsx`: 入力フィールド(W, h, t, εr, tan δ, 周波数, 目標 Z₀)
  - バリデーション(正値、合理的範囲)
  - SI 単位プリセット(mil/mm 切替)
- [ ] `ResultsPanel.tsx`: Z₀, ε_eff, 推奨 W の表示
- [ ] `CrossSectionPlot.tsx`: Plotly.js で断面と電界 |E| ヒートマップを描画
- [ ] `ComparisonTable.tsx`: FEM 値 vs Wheeler 値 vs Hammerstad 値の3列比較
- [ ] `About.tsx`: 「なぜ FEM か」「Photonic Edge について」「ライセンス」「GitHub リンク」

**完了基準**: 全主要機能が UI から操作でき、Wheeler との比較で違いが視覚化される。

### Phase 7: i18n(2-3日)

- [ ] `react-i18next` 導入・設定
- [ ] `locales/ja.json`, `locales/en.json` の作成(全 UI 文字列)
- [ ] `LanguageSwitcher.tsx`: ヘッダ右上、`JA / EN` 切替
- [ ] URL パスベースのロケール(`/ja/`, `/en/`)、ブラウザ言語からの自動検出
- [ ] About / 解説ページの両言語版

**完了基準**: ブラウザ言語に応じて初期表示が切り替わり、手動切替も機能する。

### Phase 8: パフォーマンス・UX(3-5日)

- [ ] FEM 計算を Web Worker(`workers/femWorker.ts`)に分離
- [ ] ローディングインジケータ(メッシュ生成中・FEM 計算中の進捗表示)
- [ ] エラーハンドリング(メッシュ失敗・収束失敗・無効入力)
- [ ] モバイルレスポンシブ(縦長レイアウト)
- [ ] バンドルサイズ最適化(triangle-wasm, eigen-js は遅延ロード)
- [ ] Lighthouse スコアの測定(Performance ≥ 90 を目標)

**完了基準**: 標準的な計算が 1 秒以内に完了、UI がブロックされない。

### Phase 9: ドキュメント(3-5日)

- [ ] `docs/theory.md` (EN), `docs/theory.ja.md`: FEM の数学的解説、なぜ closed-form より精度が出るかのショーケース(誤差プロット)
- [ ] `docs/validation.md`: HFSS / CST / 教科書値との比較表(数値は Tatsy が後で埋める)
- [ ] `docs/architecture.md`: アーキテクチャ図解
- [ ] `docs/deployment.md`: Cloudflare Pages デプロイ手順
- [ ] README 最終版(EN/JA): スクリーンショット、機能、ライセンス、コントリビュート方法

**完了基準**: 第三者が README から技術概要を把握でき、ローカル実行できる。

### Phase 10: デプロイ準備

- [ ] `npm run build` の成功確認
- [ ] dist サイズの確認(目標 < 5 MB gzip)
- [ ] Cloudflare Pages 設定の README 化(Tatsy が後で実行)
- [ ] DNS 設定手順の README 化(社内確認後に実行)

---

## 7. FEM 実装の数学的詳細

### 7.1 支配方程式

2D 断面で電位 φ(x, y) は

```
∇ · ( εr(x, y) ∇φ ) = 0
```

を満たす(ポアソン方程式の真空電荷ゼロ版、すなわち重み付きラプラス方程式)。

### 7.2 弱形式

テスト関数 v に対し

```
∫∫_Ω εr ∇φ · ∇v dA = 0  for all v ∈ H¹₀(Ω)
```

### 7.3 線形三角要素(T3)

要素 e の頂点を (x₁, y₁), (x₂, y₂), (x₃, y₃)、面積を A_e とすると、形状関数の勾配は定数で

```
b_i = (y_j - y_k) / (2 A_e)   (i,j,k は cyclic)
c_i = (x_k - x_j) / (2 A_e)
```

要素剛性行列(3×3)は

```
K^e_{ij} = εr_e A_e (b_i b_j + c_i c_j)
```

### 7.4 全体組立と境界条件

全要素の K^e を全体行列 K に組み付ける(疎行列)。境界条件:

- 導体表面ノード: φ = 1 V(信号導体)、φ = 0 V(接地)
- 外部境界: φ = 0(無限遠近似)
- 誘電体界面: 自動的に弱形式から処理される(明示的な処理不要)

Dirichlet 境界の適用は、対応する自由度を行列から削除するか、ペナルティ法を用いる。実装簡便さのためペナルティ法(対角要素を巨大値に置換)を推奨。

### 7.5 容量抽出

エネルギー法を採用:

```
W_e = (1/2) φ^T K φ
C   = 2 W_e / V² = φ^T K φ  (V = 1V のとき)
```

ε=1 でも同じ手順を実行し、真空容量 C₀ を得る。

### 7.6 伝送線路パラメータ

quasi-TEM 近似の下で:

```
L     = μ₀ε₀ / C₀
Z₀    = √(L / C) = 1 / (c · √(C · C₀))
ε_eff = C / C₀
```

ここで c は真空中の光速。

---

## 8. UI 仕様

### レイアウト(デスクトップ)

```
┌──────────────────────────────────────────────────┐
│ Photonic Edge | Microstrip FEM Tool      [JA|EN] │
├─────────────────┬────────────────────────────────┤
│                 │                                │
│  Parameters     │   Cross Section + |E| Heatmap  │
│  ─ W            │                                │
│  ─ h            │                                │
│  ─ t            │                                │
│  ─ εr           │                                │
│  ─ tan δ        ├────────────────────────────────┤
│  ─ Frequency    │                                │
│  ─ Target Z₀    │   Results                      │
│                 │   ─ Z₀ (FEM):     50.12 Ω     │
│  [Calculate]    │   ─ ε_eff:        3.45         │
│                 │   ─ Optimal W:    2.97 mm      │
│                 │                                │
│                 │   Comparison Table             │
│                 │   ┌──────────┬──────┬──────┐   │
│                 │   │ Method   │  Z₀  │ Δ%   │   │
│                 │   │ FEM      │50.12 │  —   │   │
│                 │   │ Hammers. │51.84 │+3.4% │   │
│                 │   │ Wheeler  │52.10 │+3.9% │   │
│                 │   └──────────┴──────┴──────┘   │
└─────────────────┴────────────────────────────────┘
```

### モバイル

縦並びに崩す: ヘッダ → パラメータフォーム → Calculate ボタン → 可視化 → 結果 → 比較表。

### スタイリング指針

- Photonic Edge コーポレートカラーに合わせる(後で Tatsy が CSS 変数で調整)
- 数値表示は等幅フォント(Roboto Mono など)
- 入力単位の明示(mm, mil 切替可)
- 控えめなアニメーション(計算中のみ)

---

## 9. i18n 仕様

### URL 構造

```
/                  → ブラウザ言語で自動リダイレクト
/ja/               → 日本語版
/en/               → 英語版
/ja/about          → 日本語 About
/en/about          → 英語 About
```

### 翻訳キー命名規約

```
form.label.trace_width
form.label.substrate_height
form.placeholder.target_z0
results.label.characteristic_impedance
results.label.effective_permittivity
errors.invalid_negative_value
about.why_fem_title
```

### 数値・単位

- 小数点はピリオド `.`(国際標準、日本語版でも統一)
- SI 単位はそのまま(mm, GHz, Ω)
- 桁区切りは使用しない(科学計算文脈)

---

## 10. 検証方針

### 単体テスト(自動)

- 解析式: 教科書の参照値(下記)に対し ±2% 以内
- FEM 平行平板: 解析解に対し ±1% 以内
- FEM 同軸線(円形メッシュで近似): 解析解に対し ±2% 以内

### 教科書参照値(Pozar, Microwave Engineering 等から)

| εr              | h [mm] | t [mm] | Target Z₀ [Ω] | Expected W [mm] |
| --------------- | ------ | ------ | ------------- | --------------- |
| 4.4 (FR-4)      | 1.6    | 0.035  | 50            | ~3.00           |
| 3.66 (RO4350B)  | 0.508  | 0.018  | 50            | ~1.13           |
| 9.8 (Alumina)   | 0.635  | 0.005  | 50            | ~0.59           |
| 2.2 (RT/duroid) | 0.787  | 0.018  | 50            | ~2.40           |

これらを `tests/validation/reference.test.ts` で自動テスト化。

### HFSS/CST 照合(手動、Tatsy が実施)

`docs/validation.md` に Tatsy が HFSS/CST シミュレーション結果を記入する欄を用意しておく。Claude Code はこの欄をプレースホルダで作成し、内容は記入しない。

---

## 11. デプロイ手順(Tatsy が実施)

開発環境では `npm run dev`、本番ビルドは `npm run build`。

Cloudflare Pages へのデプロイは初回のみ手動設定が必要:

1. GitHub repo `photonic-edge/microstrip-fem-web` を作成して push
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. ビルド設定: フレームワーク= Vite、ビルドコマンド= `npm run build`、出力ディレクトリ= `dist`
4. カスタムドメイン: `tools.photonic-edge.com` を設定
5. DNS: `photonic-edge.com` の DNS プロバイダ(要社内確認)で `tools` の CNAME を Cloudflare Pages の URL に向ける

これらの手順は `docs/deployment.md` にも記載すること。

---

## 12. v0.1 スコープ外項目(明示的に「やらない」)

以下は v0.1 では実装しない。実装したくなっても、ユーザに確認なく着手しないこと。

- 損失モデル(skin effect, dielectric loss, surface roughness)
- 周波数分散(全波解析、固有値問題)
- 差動ペア・CPW・ストリップライン・SIW などのマイクロストリップ以外の伝送線路
- 多層基板(基板層が複数枚)
- 任意断面のCAD的入力
- Touchstone (.s2p) 出力
- 計算結果の保存・共有・URL化(Permalink)
- ユーザアカウント・お気に入り
- 課金・サブスクリプション

これらは v0.2 以降の課題として `docs/roadmap.md` に記録する(本ファイルとは別)。

---

## 13. コーディング規約

- TypeScript strict mode 必須(`strict: true`、`noImplicitAny: true`)
- ESLint: `@typescript-eslint/recommended` + React hooks
- Prettier: シングルクォート、セミコロンあり、インデント 2 スペース
- 関数名は camelCase、型名は PascalCase、定数は UPPER_SNAKE_CASE
- 数式に関わるコードは LaTeX 風コメントを併記(例: `// K^e_ij = εr * A * (b_i*b_j + c_i*c_j)`)
- 物理量を扱う変数には単位をコメントで明示(例: `const h = 1.6; // [mm]`)
- 国際的な物理定数は `src/fem/constants.ts` に集約(c, μ₀, ε₀)

---

## 14. ローカル開発環境

```bash
# 初回
npm install

# 開発サーバ
npm run dev

# テスト
npm test

# 型チェック
npm run typecheck

# Lint
npm run lint

# 本番ビルド
npm run build

# 本番ビルドのプレビュー
npm run preview
```

Node.js は v20 LTS 以上を想定。

---

## 15. Tatsy(Maintainer)の責任範囲

以下は Claude Code ではなく Tatsy が実施する:

- HFSS/CST による検証データの収集・docs/validation.md への記入
- Photonic Edge コーポレートデザイン(色・フォント等)の適用判断
- DNS 設定(社内確認後)
- Cloudflare Pages 初回セットアップ(GitHub 連携)
- 公開タイミング・ローンチ告知(Show HN など)
- v0.2 以降の優先順位判断
- 翻訳の最終チェック(Claude Code が初版を作成、Tatsy が校正)

---

## 16. 進め方の原則

- 各 Phase の完了時に必ずユーザに報告し、確認を取ってから次へ進む
- 設計判断で迷うときは、本ドキュメントの「なぜ」セクションに立ち戻る
- スコープ外項目への誘惑があったら、`docs/roadmap.md`(将来作成)に記録だけして実装しない
- コードを書く前にテストを書く(TDD 推奨、ただし強制はしない)
- コミットは細かく、メッセージは英語で `feat:`, `fix:`, `docs:`, `test:`, `refactor:` のプレフィックス付き
- 大きな設計変更が必要と判断したら、実装前に必ずユーザに相談

---

**最終更新**: 2026-05-07
**作成者**: Tatsy + Claude(対話による設計セッション)
