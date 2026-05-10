# 理論

マイクロストリップ断面に対する 2D quasi-static FEM 解析。電磁気学を一通り
理解している読者がリポジトリだけでコードを追えるよう書いてある。

英語版は [`theory.md`](./theory.md)。

## 1. なぜ FEM か

Hammerstad–Jensen (HJ) や Wheeler / Pozar の閉形式は、ある特定の動作領域
(薄導体、適度な W/h、単層の均質基板、quasi-TEM) の測定値・等角写像解に対し
てフィッティングされた式である。この範囲内では Z₀ で約 0.03 %、ε_eff で約
0.01 % の精度が公称される。

しかしこの範囲を外れる(無視できない導体厚、極端に小さいまたは大きい W/h、
多層基板、高周波分散)と精度は黙って劣化する。式そのものは誤差を出力しない
ので、ユーザは間違った値を得たことに気付かない。

PDE を直接解けばこの失敗モードは存在しない。メッシュが形状を解像していれば
誤差は離散化に支配され、こちらで制御できる。代償は 1 配置あたり数百ミリ秒
の計算で、これは Web Worker が UI から隠す。

## 2. 境界値問題

断面を 2D quasi-electrostatics の問題としてモデル化する。打ち切り領域 Ω
内の電位 φ(x, y) は

$$\nabla \cdot \big( \varepsilon_r(x, y)\, \nabla \varphi \big) = 0,$$

を満たし、境界条件は

| 境界             | 条件                                   |
| ---------------- | -------------------------------------- |
| 信号導体表面     | φ = V_drive (コード上 1 V)             |
| 接地面           | φ = 0                                  |
| 外側打ち切り境界 | φ = 0 (∞ 近似)                         |
| 基板–空気界面    | φ と εr ∂φ/∂n の連続(弱形式が自動処理) |

ε_r(x, y) は誘電体領域内では基板の比誘電率、空気領域では 1。自由電荷はない
ので右辺は 0。

導体は完全電気導体の「穴」として扱う。導体内部はメッシュせず、その境界線分
が Dirichlet 条件を保持する。

## 3. 弱形式

テスト関数 v ∈ H¹₀(Ω)(Dirichlet 境界上で 0)を掛けて部分積分する:

$$
\int_\Omega \varepsilon_r\, \nabla \varphi \cdot \nabla v\, \mathrm{d}A = 0
\quad \forall v \in H^1_0(\Omega).
$$

誘電体界面の連続条件は、共有エッジで両側の法線フラックス寄与が相殺するため
弱形式から自動的に取り扱われる。

## 4. 線形三角要素 (T3) 離散化

Ω を線形三角要素(3 節点)で分割する。要素 e の頂点を (x_i, y_i),
i = 1, 2, 3 とすると、バリセントリック形状関数 N_i(x, y) は線形なのでその
勾配は要素内で定数:

$$
b_i = \frac{y_j - y_k}{2 A_e}, \qquad
c_i = \frac{x_k - x_j}{2 A_e}, \qquad
A_e = \tfrac{1}{2} \big| (x_2 - x_1)(y_3 - y_1) - (x_3 - x_1)(y_2 - y_1) \big|,
$$

ここで (i, j, k) は (1, 2, 3) の循環順列。要素剛性行列は

$$K^e_{ij} = \varepsilon_{r,e}\, A_e\, (b_i b_j + c_i c_j),$$

実装は [`src/fem/assembly.ts`](../src/fem/assembly.ts)。`A_e b_i b_j` は
無次元なので組み立てた K も無次元、物理的な ε₀ は容量算出時に再付与する。

## 5. 全体組立

各 (i, j) ペアの K^e を、頂点のグローバルインデックスに従って全体行列 K
(N × N、N はメッシュ頂点数)へ加算する。COO バッファに (row, col, value)
の triplet を蓄積し、ソート済み列・重複加算済みの CSR に圧縮する。両方の
データ構造は [`src/fem/sparse.ts`](../src/fem/sparse.ts)。

## 6. Dirichlet 境界条件 — 行/列消去法

素朴な **ペナルティ法** (Dirichlet 節点 i に対し `K[i, i] += P`、
`b[i] += P · φ̂_i`)は直接ソルバなら扱いやすいが、CG ソルバとは相性が悪い:
残差ノルムがペナルティ行に支配されて、CG は内側の節点が動く前に「収束」
してしまう。標準的な代替手法を採る:

各 Dirichlet 節点 i (規定値 φ̂_i) について:

1. 列 i の寄与 K[:, i] · φ̂_i を b から引く(残った free–free 系が一貫
   するように)
2. 行 i と列 i をゼロ化
3. K[i, i] = 1, b[i] = φ̂_i に設定

行列は対称性を保ち、条件数も悪化せず、CG はクリーンな問題を解ける。実装は
[`src/fem/boundary.ts`](../src/fem/boundary.ts)。

## 7. 線形ソルバ — Jacobi 前処理共役勾配法

[CLAUDE.md §3](../CLAUDE.md) は当初 SimplicialLDLT を期待していたが、
公開されている `eigen` WASM パッケージは密 Cholesky しか expose していない
(SimplicialLDLT は未公開)。SuiteSparse を WASM コンパイルするのは v0.1
にとっては重すぎる。CG + Jacobi 前処理は現状の ~50 k DOF microstrip 問題
で sub-second なので、これで出荷し、profiling が要求すれば後で見直す。

実装は教科書通りの PCG:

```text
r₀ = b − K x₀
z₀ = M⁻¹ r₀,  p₀ = z₀,  ρ₀ = r₀ · z₀
for k = 0, 1, …
    Kp  = K p_k
    α   = ρ_k / (p_k · Kp)
    x   ← x + α p_k
    r   ← r − α Kp
    if ‖r‖ ≤ tol · ‖b‖ break
    z   = M⁻¹ r
    β   = (r · z) / ρ_k
    p   ← z + β p
    ρ   ← r · z
```

M = diag(K)。詳細は [`src/fem/solver.ts`](../src/fem/solver.ts)。

## 8. エネルギーからの容量抽出

単位駆動 (V_drive = 1 V) のとき、面外単位長さあたりの蓄積静電エネルギーは

$$
\frac{W_e}{L} = \tfrac{1}{2} \int\!\!\int \varepsilon\, |\nabla \varphi|^2\, \mathrm{d}A
              = \tfrac{1}{2}\, \varepsilon_0\, \varphi^\top K\, \varphi,
$$

なので単位長さあたりの容量は

$$
\frac{C}{L} = \frac{2 W_e / L}{V_\text{drive}^2} = \varepsilon_0\, \varphi^\top K\, \varphi
\quad [\mathrm{F/m}].
$$

二次形式 `φᵀ K φ` は無次元(面積 × 長さの二乗の逆)なので、結果は形状を
mm で与えても m で与えても F/m 単位になる。実装は
[`src/fem/capacitance.ts`](../src/fem/capacitance.ts)。

## 9. 2 回の解で Z₀ と ε_eff

マイクロストリップは quasi-TEM 線路。FEM を 2 回実行する:

1. **誘電体あり** — 基板 ε_r、空気 ε_r = 1 — で C を取得
2. **真空** — どこも ε_r ≡ 1 — で C₀ を取得

単位長あたりインダクタンス L = μ₀ε₀ / C₀ は純粋に磁気的な量なので誘電体
を見ない。よって

$$
Z_0 = \sqrt{L / C} = \frac{1}{c\, \sqrt{C \cdot C_0}}, \qquad
\varepsilon_\mathrm{eff} = C / C_0.
$$

これらの恒等式と 2 回解のオーケストレーションは
[`src/fem/tlanalysis.ts`](../src/fem/tlanalysis.ts)。

## 10. 二分法による逆設計

目標 Z₀ から W を求めたいとき。Z₀(W) は固定 h, t, ε_r に対して単調減少なの
で、二分法で十分。HJ の解析的逆解で初期 bracket を作り(HJ 自体も内部で
二分法、forward しかないため)、その範囲内で粗メッシュの FEM Z₀(W) を二分
法。最後に得られた W で 1 回だけ精度メッシュで解き直す。実装は
[`src/optimization/bisection.ts`](../src/optimization/bisection.ts)、
Worker 側の繋ぎは [`src/workers/femWorker.ts`](../src/workers/femWorker.ts)。

## 11. 検証

Phase 3 / 4 / 5 完了テストはコードと同居:

- **平行平板真空コンデンサ**(`tests/parallel-plate.test.ts`) — 線形 T3 が
  φ = y/h を厳密に表現できるので、復元 C は ε₀ · W/h と round-off 一致。
  これで assembly + BC + solver パイプラインを単独検証する。
- **FEM vs Hammerstad–Jensen**(`tests/microstrip.test.ts`) — 3 種の参照
  基板(FR-4、RT/duroid 5880、alumina)で W = 50 Ω 標準形状。FEM は HJ と
  2 % 以内一致。
- **二分法ラウンドトリップ**(`tests/bisection.test.ts`) — 50 Ω 目標で
  復元 W が \|Z₀ − 50\| < 0.05 Ω を満たす。Phase 5 仕様。

外部リファレンス(HFSS / CST / 教科書値)との照合は
[`validation.md`](./validation.md)。

## 12. v0.1 スコープ(本番経路として継続)

- 損失なし(tan δ・表皮効果・表面粗さ)
- 分散なし: quasi-static、周波数非依存(表示する Z₀(f) の分散補正は
  KJ 後処理で対応)
- シングルエンドのマイクロストリップのみ — 差動・CPW・ストリップライン
  は未対応
- 単層基板のみ

これらは **メイン計算機** での意図的な省略。v0.2 で分散制約を外す
ベクトル全波 FEM を追加した(§13)が、本番経路を置き換えるのではなく
別の "experimental" ページに分離している。

## 13. v0.2 — ベクトル全波固有値 FEM (experimental ページ)

全波経路は `research/src/fem-fullwave/` 配下に存在し、「Full-wave
(experimental)」ページから到達できる。SC-PML 切り捨てを伴う
マイクロストリップ断面の混合 (E_t, E_z) ベクトル Helmholtz 固有値
問題を解き、複素伝搬定数 β² を Maxwell から直接復元する。end-to-end
検証: ε_eff(FEM) が FR-4 の f = 20 / 30 GHz で KJ と 0.3 % 以内一致
([`validation.md`](./validation.md))。内側ソルバはまだ本番運用品質
ではない — gating 項目は [`roadmap.md`](./roadmap.md)。

### 13.1 定式化

`exp(−jβz)` 伝搬の 2-D 断面で `∂_z → −jβ` を ∇ × (μ_r⁻¹ ∇ × E) =
k₀² ε_r E に代入し、共役テスト関数で乗じて積分すると標準的な
クロス積展開を経て:

```
  ∫ μ_r⁻¹ (curl_t E_t)(curl_t F_t)*  +  ∫ μ_r⁻¹ ∇E_z · ∇F_z*
  − k₀² ∫ ε_r (E_t · F_t* + E_z F_z*)
  − jβ ∫ μ_r⁻¹ (∇E_z · F_t* − E_t · ∇F_z*)
  = − β² ∫ μ_r⁻¹ E_t · F_t*.
```

`−jβ` 結合により形式上は β について 2 次。(u, v) = (E_t, E_z) で
ブロック分解し節点式から v を消去すると `−jβ × −jβ = β²` で
畳み込まれ、エッジ DoF のみの **線形一般化固有値問題** に縮約される:

```
  K_t u  =  β² M̃ u,    M̃ = M_t − C_tz K_n⁻¹ C_tz^T.
```

実装は `mixed-assembly.ts` / `schur.ts`(実数経路)と
`mixed-pml-assembly.ts` / `complex-schur.ts`(PML 経路)。

### 13.2 離散空間

- **E_t** は三角形上の Whitney 1-form / Nédélec エッジ空間。頂点
  `a` → `b` のエッジ基底関数は `N_{ab} = λ_a ∇λ_b − λ_b ∇λ_a`、curl
  共形(tangential 連続が自然)。三角形あたり 3 DoF。

- **E_z** は標準の P1 nodal Lagrange 空間 — 準静解で φ に使っている
  ものと同じ。

- 離散勾配作用素 **G** は nodal スカラーをエッジ DoF 勾配にマップ
  する。`K_curl · G f = 0` は浮動小数点精度で厳密成立 — Nédélec 構成
  の根幹をなす離散 curl-grad 恒等式。G から構築するデフレータが、
  本来はスプリアスな勾配部分空間を固有値ソルバから除去する。

### 13.3 SC-PML

Berenger / Taflove の座標伸縮 PML は `∂/∂x → (1/s_x) ∂/∂x`
(`s_x = 1 − jκ_x(x)/ω`)に置き換える。s 因子を curl 作用素に
押し込むと実効的な異方性材料テンソルが得られる:

```
  ε̃     = ε_r · diag(s_y/s_x, s_x/s_y, s_x s_y)
  1/μ̃  = (1/μ_r) · diag(s_y/s_x, s_x/s_y, 1/(s_x s_y))
```

`pml.ts` が三角形ごとのスカラー / テンソル重みを生成し、異方性複素
組立モジュールに供給する。多項式テーパで内側 PML 境界の反射は連続
極限でゼロ。

### 13.4 固有値ソルバ

複素行列系は **複素対称** (A = Aᵀ だが A ≠ A^H — PML が意図的に
Hermitian 対称性を破る)。標準的な Hermitian Krylov 法 (CG・MINRES)
は複素対称問題で実残差ノルムの収束保証を失うため、内側線形ソルバは
**複素 Bi-CGSTAB**(Jacobi 対角前処理)、外側固有値ソルバは双線形
Rayleigh quotient によるシフト・インバート冪乗法。詳細(双線形
`cdot` vs Hermitian `cdotH` の使い分け)は `complex-eigsolve.ts`。

### 13.5 固有ペアからの ε_eff と Z₀

```
  ε_eff(f) = β² / k₀²                                 (複素)
  V        = ∫_0^h E_y dy  (x = 0 で線積分)
  P        = ½ Re ∫ (E × H*)_z dA                     (Poynting 流)
  Z₀       = |V|² / (2 P)                              (V-P 定義)
```

H は `exp(−jβz)` の Maxwell から復元:
`H_t = (β/ωμ)(ẑ × E_t) + (j/ωμ)(∇E_z × ẑ)`. V-P を選ぶのは V が
単一の 1 次元線積分で済み、P は経路非依存 — どちらも FEM 固有
ベクトルから自然に評価できるため。実装は `microstrip-z0.ts`。

### 13.6 本番ソルバに未昇格な理由

数学は正しい。内側 Bi-CGSTAB は `K_t − σ M̃` のシフト後行列が
自然スケールから数桁低い場合(=低周波数)に停滞し、粗メッシュ +
1 点直交での V-P Z₀ 抽出は KJ から ~30 % 上振れする。両方とも
[`roadmap.md`](./roadmap.md) 記載の項目で解消可能 — ILU(0) 前処理が
収束フロアを下げ、多点直交 + 細メッシュが Z₀ ギャップを縮める。
これらが入った段階で experimental ページから本番昇格する。
