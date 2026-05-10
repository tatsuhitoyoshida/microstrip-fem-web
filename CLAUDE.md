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

| 領域              | 採用                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| 言語              | TypeScript(strict mode、`noUncheckedIndexedAccess` 有効)                            |
| UI フレームワーク | React 19                                                                            |
| ビルドツール      | Vite(Rolldown バンドラ)                                                             |
| メッシュ生成      | `triangle-wasm`(Triangle の WebAssembly ポート)                                     |
| 線形ソルバ        | 自作 Jacobi 前処理付き共役勾配法 (`src/fem/solver.ts`)                              |
| FEM 組立          | TypeScript で自作                                                                   |
| 可視化            | Plotly.js(電界ヒートマップ・スイープ曲線、動的 import で遅延ロード)                 |
| 国際化            | `react-i18next`(JA/EN bilingual)                                                    |
| 計算オフロード    | Web Worker(メインスレッドをブロックしない)                                          |
| テスト            | Vitest                                                                              |
| Lint/Format       | ESLint + Prettier                                                                   |
| デプロイ          | Cloudflare Pages(無料枠で十分)                                                      |

ライブラリ選定の意図:

- `triangle-wasm`: 任意ポリゴン領域のDelaunay三角分割に対応。将来CPW/ストリップラインに拡張する際にも同じツールで対応可能
- 自作 CG ソルバ: 当初 `eigen-js` を想定していたが、公開されている WASM ビルドは `SimplicialLDLT` を露出していなかった。~10k DOF の本問題では Jacobi-PCG で十分にサブ秒で解け、外部依存も減らせるため自作に倒した。プロファイル次第で IC(0) や自作スパース LDLT への置換余地は残してある(詳細: `src/fem/solver.ts` 冒頭コメント)。
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

> **現状(2026-05-08 時点)**: Phase 0–9 まで実装・コミット済み。残るは Phase 10(Cloudflare Pages への初回デプロイ)で、これは Tatsy が手動で実施する。下記チェックリストは "何をどの順で作ったか" の歴史記録として残しているので、新規実装時はこのフェーズ表ではなく `docs/architecture.md` と既存コードを参照のこと。

各フェーズの完了基準は当時のものをそのまま残してある。新規変更が下記の完了基準を破らないかは `tests/` の各テストが回帰バーになっている。

### Phase 0: プロジェクト初期化 ✅

- [x] `npm create vite@latest` で React + TypeScript プロジェクト作成
- [x] ESLint + Prettier 設定
- [x] Vitest 導入
- [x] MIT LICENSE 作成(Copyright (c) 2026 Photonic Edge Inc.)
- [x] README skeleton(EN/JA)
- [x] `.gitignore`(`node_modules`, `dist`, `.DS_Store` など)
- [x] 初回コミット可能な状態

**完了基準**: `npm run dev` でデフォルト Vite ページが表示される。

### Phase 1: 解析公式の実装 ✅

ベースラインかつ UI のフォールバック値として最初に実装した。FEM ができる前から UI が動かせる。

- [x] `analytical/wheeler.ts`: Wheeler の式で Z₀(W, h, εr, t) を計算
- [x] `analytical/hammerstad.ts`: Hammerstad-Jensen の式で Z₀ と ε_eff を計算
- [x] 教科書の参照値(下記検証セクション参照)に対する単体テスト

**完了基準**: 50 Ω@FR-4(εr=4.4, h=1.6mm)で W ≈ 3.0mm が ±2% 以内で得られる。

### Phase 2: メッシュ生成 ✅

- [x] `triangle-wasm` を依存追加・WASM ロード処理
- [x] `geometry.ts`: マイクロストリップ断面のパラメータ → PSLG(点・線分・領域マーカ・穴)変換
  - 外側計算領域: 基板幅の 10〜20倍、基板厚の 10〜20倍を上空に確保
  - 接地面: 領域下端
  - 基板: εr 領域マーカ
  - 導体: 矩形(W × t)を「穴」として扱い、その境界を Dirichlet境界とする
- [x] `mesh.ts`: triangle-wasm 呼び出しラッパ。最大面積制約・最小角度制約を指定
- [x] 導体エッジ近傍の局所細分化(adaptive refinement)
- [x] デバッグ用メッシュ可視化機能(Plotly.js でメッシュエッジを描画)

**完了基準**: 標準的な microstrip 形状でクオリティの高いメッシュ(最小角度 ≥ 25°)が生成され、導体エッジ周辺が密になっていることを目視確認。

### Phase 3: FEM コア実装 ✅

- [x] `assembly.ts`: 線形三角要素(T3)の要素剛性行列を実装
  - 要素 e の頂点 (x_i, y_i)、面積 A_e、形状関数の勾配 b_i, c_i から
  - K^e\_{ij} = (ε_e / 4A_e) · (b_i b_j + c_i c_j)
- [x] 全体剛性行列 K の組立(スパース行列、CSR/COO 形式)
- [x] Dirichlet 境界条件の適用(行/列消去法。詳細は §7.4)
- [x] `solver.ts`: 自作 Jacobi-PCG で連立方程式を解く(eigen-js は不採用、§3 参照)
- [x] 既知解との照合: 平行平板コンデンサ(解析解 C = εA/d)で精度検証

**完了基準**: 平行平板コンデンサ問題で 1% 以内の誤差で C が再現される。

### Phase 4: 容量・伝送線路パラメータ抽出 ✅

- [x] `capacitance.ts`: エネルギー法 W_e = (1/2) φ^T K φ から C = 2W_e / V² を計算
- [x] εr ありで C、ε=1 で C₀(L = μ₀ε₀ / C₀)を計算
- [x] `tlanalysis.ts`: Z₀ = √(L/C) = 1/(c √(C·C₀))、ε_eff = C/C₀
- [x] Phase 1 の解析式との比較(薄導体・標準形状で 2% 以内一致)

**完了基準**: 標準的な microstrip 形状で Hammerstad 式と 2% 以内、HFSS 結果と 1% 以内で Z₀ が一致。

### Phase 5: 最適化 ✅

- [x] `bisection.ts`: 二分法で Z₀(W) = Z₀_target を満たす W を探索
- [x] 初期範囲は Hammerstad 式の解の周辺(0.5×〜2×)で限定
- [x] 収束判定: |Z₀ - Z₀_target| < 0.05 Ω

**完了基準**: 50 Ω 目標で W が 0.05 Ω 精度で求まる。

### Phase 6: UI 実装 ✅

- [x] `ParameterForm.tsx`: 入力フィールド(W, h, t, εr, 目標 Z₀)
  - バリデーション(正値、合理的範囲)
  - SI 単位プリセット(mil/mm 切替)
- [x] `ResultsPanel.tsx`: Z₀, ε_eff, 推奨 W の表示
- [x] `CrossSectionPlot.tsx`: Plotly.js で断面と電界 |E| ヒートマップを描画
- [x] `ComparisonTable.tsx`: FEM 値 vs Wheeler 値 vs Hammerstad 値の3列比較
- [x] `About.tsx`: 「なぜ FEM か」「Photonic Edge について」「ライセンス」「GitHub リンク」

**完了基準**: 全主要機能が UI から操作でき、Wheeler との比較で違いが視覚化される。

### Phase 7: i18n ✅

- [x] `react-i18next` 導入・設定
- [x] `locales/ja.json`, `locales/en.json` の作成(全 UI 文字列)
- [x] `LanguageSwitcher.tsx`: ヘッダ右上、`JA / EN` 切替
- [x] URL パスベースのロケール(`/ja/`, `/en/`)、ブラウザ言語からの自動検出
- [x] About / 解説ページの両言語版

**完了基準**: ブラウザ言語に応じて初期表示が切り替わり、手動切替も機能する。

### Phase 8: パフォーマンス・UX ✅

- [x] FEM 計算を Web Worker(`workers/femWorker.ts`)に分離
- [x] ローディングインジケータ(メッシュ生成中・FEM 計算中の進捗表示)
- [x] エラーハンドリング(メッシュ失敗・収束失敗・無効入力)
- [x] モバイルレスポンシブ(縦長レイアウト)
- [x] バンドルサイズ最適化(Plotly は動的 import で遅延ロード)
- [x] Lighthouse スコアの測定(Performance ≥ 90 を目標)

**完了基準**: 標準的な計算が 1 秒以内に完了、UI がブロックされない。

### Phase 9: ドキュメント ✅

- [x] `docs/theory.md` (EN), `docs/theory.ja.md`: FEM の数学的解説、なぜ closed-form より精度が出るかのショーケース(誤差プロット)
- [x] `docs/validation.md`: HFSS / CST / 教科書値との比較表(数値は Tatsy が後で埋める)
- [x] `docs/architecture.md`: アーキテクチャ図解
- [x] `docs/deployment.md`: Cloudflare Pages デプロイ手順
- [x] README 最終版(EN/JA): スクリーンショット、機能、ライセンス、コントリビュート方法

**完了基準**: 第三者が README から技術概要を把握でき、ローカル実行できる。

### Phase 10: デプロイ準備(Tatsy 担当)

- [x] `npm run build` の成功確認
- [x] dist サイズの確認(目標 < 5 MB gzip)
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

Dirichlet 境界の適用は **行/列消去法** を採用している(`src/fem/boundary.ts`)。各 Dirichlet 節点 i に対し、列 K[:, i] · φ̂_i 寄与を b から差し引いた上で行 i・列 i を 0 化、K[i, i] = 1, b[i] = φ̂_i とする。これで残りの自由度に対する系は対称・良条件で、CG が素直に収束する。

当初は実装簡便さからペナルティ法(対角要素を巨大値に置換)を検討したが、ペナルティ行のせいで残差ノルムが支配され、内部残差が落ちる前に CG が「収束」と判定して止まる現象が出たため不採用とした。同種の事情で再導入は推奨しない。

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
npm test                                    # watch モード
npm run test:run                            # 単発実行(CI / エージェント向け)
npm run test:ui                             # Vitest UI モード
npx vitest run tests/microstrip.test.ts     # 単一ファイルだけ
npx vitest run -t "FR-4"                    # テスト名パターン

# 型チェック
npm run typecheck

# Lint / Format
npm run lint
npm run lint:fix
npm run format
npm run format:check

# 本番ビルド
npm run build

# 本番ビルドのプレビュー
npm run preview
```

Node.js は v20 LTS 以上を想定。

---

## 14.5 Implementation gotchas(再現の難しい既知の罠)

仕様書にも README にも書きづらいが、知らないと踏む地雷。新規エージェントは作業前に一度目を通すこと。

- **`triangle-wasm` を自前ビルドに差し替え済み**: 上流の `triangle-wasm@1.0.0` は `ALLOW_MEMORY_GROWTH=0` で 16 MB 固定ヒープにコンパイルされており、~60k 三角形で天井に当たっていた。`vendor/triangle-wasm/build-with-growth.sh` で Triangle (Shewchuk) を `-s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=512MB` で再ビルドし、`public/triangle.out.wasm` と `node_modules/triangle-wasm/triangle.out.{wasm,js}` を差し替え。実用上限はおよそ ~300k 三角形(それ以上で Triangle 内部が null pointlist を返すため、`solveMicrostripAdaptive` は catch して停止理由 'triangleCeiling' で終了)。**`npm install` 後は `package.json` の `postinstall` フック(`scripts/install-triangle-wasm.mjs`)が自動的に node_modules を上書きする** ので手動の再差し替えは不要。手動で走らせる場合は `npm run install:triangle-wasm`。
- **テスト時の WebAssembly ローダ shim**: `tests/setup.ts` で `WebAssembly.instantiateStreaming` を `undefined` に潰している。これは Emscripten が Node 22+ では fetch 経由を選ぼうとするが、テスト側は `file://` パス(`fs.readFileSync` 経路)を渡しているため。掃除しないこと、load-bearing。
- **Bisection は粗メッシュで走る**: `src/workers/femWorker.ts` は二分探索プローブ中だけ `geometry.{substrateMaxArea, airMaxArea}` を粗く上書きし、最終 W が定まった後で初めてユーザ指定密度の本番ソルブを 1 回走らせる。8〜9 回プローブをサブ秒に収めるための仕掛け。
- **Plotly は動的 import**: `CrossSectionPlot.tsx` 内で初回結果到着時に `plotly.js-dist-min` を import している(~1.4 MB チャンク)。他所で静的に import しないこと。バンドル予算を破壊する。
- **Web Worker は Vite の `?worker` 構文で生成**: `useMicrostripCalc.ts` の `import FemWorker from '../workers/femWorker.ts?worker'` が唯一のワーカエントリ。普通の import に書き換えると Vite がチャンクを分けてくれない。
- **`noUncheckedIndexedAccess` 有効**: 配列アクセスの戻り値が `T | undefined` 型になるため、FEM コードでは至るところで `!` を付けて narrow している。新規コードも同じ作法で。
- **OneDrive 配下のリポジトリ**: 現在 `C:\Users\Tatsuhito\OneDrive\…` 配下に置かれている。OneDrive が `.git/index.lock` や packfile を sync 中に掴むと `git commit` / `git gc` が偶発的に失敗するため、エクスプローラで本フォルダを「常にこのデバイス上に保持」に固定しておくこと。

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

- **FEM パイプライン(`src/fem/*.ts`, `src/optimization/*.ts`)を変更する前にユーザに確認**を取る。`tests/parallel-plate.test.ts` と `tests/microstrip.test.ts` が唯一の数値回帰バーで、これを破ると気付かないまま精度が落ちるリスクがあるため。
- **§12 のスコープ外項目に踏み込む前にユーザに確認**を取る。誘惑があっても `docs/roadmap.md`(将来作成)に記録だけして実装しない。
- 設計判断で迷うときは、本ドキュメントの「なぜ」セクションに立ち戻る
- コードを書く前にテストを書く(TDD 推奨、ただし強制はしない)
- コミットは細かく、メッセージは英語で `feat:`, `fix:`, `docs:`, `test:`, `refactor:` のプレフィックス付き
- 大きな設計変更が必要と判断したら、実装前に必ずユーザに相談

---

**最終更新**: 2026-05-08(Phase 0–9 完了反映、技術スタック・境界条件・gotchas を実装に同期)
**作成者**: Tatsy + Claude(対話による設計セッション)
