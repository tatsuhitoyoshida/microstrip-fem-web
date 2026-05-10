# Theory

A 2-D quasi-static finite-element treatment of a microstrip cross-section,
written so a reader who already knows electromagnetics can follow the code
without leaving the repo.

The Japanese version of this document is at [`theory.ja.md`](./theory.ja.md).

## 1. Why FEM, when Hammerstad–Jensen is right there?

The Hammerstad–Jensen (HJ) closed form (and the older Wheeler / Pozar
expressions) was fitted against measurements and conformal-mapping results
for a particular operating regime: thin conductors, moderate W/h, single
homogeneous substrate, quasi-TEM operation. Inside that envelope the HJ
formula is quoted as accurate to about 0.03 % for Z₀ and 0.01 % for ε_eff.

Outside that envelope — appreciable conductor thickness, very low or very
high W/h, multilayer dielectrics, or higher-frequency dispersion — the
formula degrades silently. There is no internal error indicator; the user
just gets a wrong number.

A direct PDE solve does not have that failure mode. As long as the mesh
resolves the geometry, the FEM error is a function of the discretisation,
which we control. The cost is a few hundred milliseconds of compute per
configuration, which a Web Worker hides from the UI.

## 2. The boundary value problem

We model the cross-section as a 2-D quasi-electrostatic problem. The
electric potential φ(x, y) inside the truncation domain Ω satisfies

$$\nabla \cdot \big( \varepsilon_r(x, y)\, \nabla \varphi \big) = 0,$$

with boundary conditions

| Boundary                 | Condition                                               |
| ------------------------ | ------------------------------------------------------- |
| Signal conductor surface | φ = V_drive (= 1 V in the code)                         |
| Ground plane             | φ = 0                                                   |
| Outer truncation box     | φ = 0 (∞ approximation)                                 |
| Substrate–air interface  | continuity of φ and εr ∂φ/∂n (handled by the weak form) |

ε_r(x, y) is the substrate permittivity inside the dielectric region and 1
in air. There are no free charges, so the right-hand side is zero.

The conductor is treated as a perfect-electric-conductor _hole_: we do not
mesh inside it, and its boundary segments carry a Dirichlet condition.

## 3. Weak form

Multiply by a test function v ∈ H¹₀(Ω) (zero on Dirichlet boundaries) and
integrate by parts:

$$
\int_\Omega \varepsilon_r\, \nabla \varphi \cdot \nabla v\, \mathrm{d}A = 0
\quad \forall v \in H^1_0(\Omega).
$$

The dielectric-interface continuity drops out automatically because
opposite-sign normal-flux contributions cancel along shared edges.

## 4. Linear triangle (T3) discretisation

We tessellate Ω with linear three-node triangles. On element e with
vertices (x_i, y_i), i = 1, 2, 3, the barycentric shape functions
N_i(x, y) are linear, so their gradients are constant inside the element:

$$
b_i = \frac{y_j - y_k}{2 A_e}, \qquad
c_i = \frac{x_k - x_j}{2 A_e}, \qquad
A_e = \tfrac{1}{2} \big| (x_2 - x_1)(y_3 - y_1) - (x_3 - x_1)(y_2 - y_1) \big|,
$$

where (i, j, k) is a cyclic permutation of (1, 2, 3). The element
stiffness matrix is

$$K^e_{ij} = \varepsilon_{r,e}\, A_e\, (b_i b_j + c_i c_j),$$

implemented in [`src/fem/assembly.ts`](../src/fem/assembly.ts). Note that
because A_e b_i b_j is dimensionless, the assembled K is dimensionless;
the physical ε₀ is reattached at the capacitance step.

## 5. Global assembly

Each (i, j) pair in K^e is added to the global K (size N × N where N is
the number of mesh vertices) at the row / column given by the global
indices of those vertices. We accumulate triplets (row, col, value) into a
COO buffer and compact to CSR with sorted columns and summed duplicates;
both data structures live in
[`src/fem/sparse.ts`](../src/fem/sparse.ts).

## 6. Dirichlet boundary conditions — row/column elimination

The naive **penalty method** (`K[i, i] += P` and `b[i] += P · φ̂_i` for
each Dirichlet node) is convenient for direct solvers but interacts badly
with conjugate gradients: the residual norm is dominated by the penalty
rows, so CG declares convergence long before the interior nodes have
moved. We take the standard alternative:

For each Dirichlet node i with prescribed value φ̂_i,

1. Subtract the column-i contribution K[:, i] · φ̂_i from b (so the
   remaining free-free system is consistent).
2. Zero row i and column i.
3. Set K[i, i] = 1 and b[i] = φ̂_i.

The matrix stays symmetric, the conditioning stays sane, and CG converges
on a clean problem. Implementation in
[`src/fem/boundary.ts`](../src/fem/boundary.ts).

## 7. Linear solver — Jacobi-preconditioned conjugate gradient

We do **not** use a direct sparse Cholesky / LDLT, despite what
[CLAUDE.md §3](../CLAUDE.md) originally hoped: the published `eigen` WASM
package does not expose `SimplicialLDLT` (only dense decompositions).
Compiling SuiteSparse to WASM is too much for v0.1. CG with a Jacobi
(diagonal) preconditioner is sub-second on the ~50 k-DOF microstrip
problems we currently produce, so we ship that and revisit later if
profiling demands it.

The implementation is the textbook PCG:

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

with M = diag(K). See [`src/fem/solver.ts`](../src/fem/solver.ts).

## 8. Capacitance via energy

For unit drive (V_drive = 1 V), the stored electrostatic energy per unit
length out of plane is

$$
\frac{W_e}{L} = \tfrac{1}{2} \int\!\!\int \varepsilon\, |\nabla \varphi|^2\, \mathrm{d}A
              = \tfrac{1}{2}\, \varepsilon_0\, \varphi^\top K\, \varphi,
$$

so the per-unit-length capacitance is

$$
\frac{C}{L} = \frac{2 W_e / L}{V_\text{drive}^2} = \varepsilon_0\, \varphi^\top K\, \varphi
\quad [\mathrm{F/m}].
$$

The bilinear form `φᵀ K φ` is dimensionless (areas times squared inverse
lengths), so the result is in farads per metre regardless of whether the
geometry is supplied in mm or m. See
[`src/fem/capacitance.ts`](../src/fem/capacitance.ts).

## 9. Z₀ and ε_eff from two solves

A microstrip is a quasi-TEM line. We run the FEM twice:

1. **With dielectric** — substrate ε_r, air ε_r = 1 — to get C.
2. **Vacuum** — ε_r ≡ 1 everywhere — to get C₀.

The per-unit-length inductance is L = μ₀ε₀ / C₀ (it is a purely magnetic
quantity and does not see the dielectric), so

$$
Z_0 = \sqrt{L / C} = \frac{1}{c\, \sqrt{C \cdot C_0}}, \qquad
\varepsilon_\mathrm{eff} = C / C_0.
$$

These two identities are wrapped in
[`src/fem/tlanalysis.ts`](../src/fem/tlanalysis.ts) along with the
two-solve orchestration.

## 10. Inverse design via bisection

Given a target Z₀, we want the W that hits it. Z₀(W) is monotonically
decreasing in W (for fixed h, t, ε_r), so bisection is the obvious
choice. We seed the bracket with a quick analytical inversion of HJ — HJ
itself is bisected internally because it is forward-only — and then
bisect FEM Z₀(W) on a coarse mesh, finishing with one report-quality
solve at the recovered W. See
[`src/optimization/bisection.ts`](../src/optimization/bisection.ts) and
the worker glue in
[`src/workers/femWorker.ts`](../src/workers/femWorker.ts).

## 11. Validation

The Phase 3 / 4 / 5 completion tests live alongside the code:

- **Parallel-plate vacuum capacitor** (`tests/parallel-plate.test.ts`) —
  φ = y/h is captured exactly by linear T3 elements, so the recovered C
  matches ε₀ · W/h to round-off. This isolates the assembly + BC + solver
  pipeline.
- **FEM vs Hammerstad–Jensen** (`tests/microstrip.test.ts`) — three
  reference substrates (FR-4, RT/duroid 5880, alumina) at the canonical
  W = 50 Ω geometry. FEM agrees with HJ within 2 %.
- **Bisection round trip** (`tests/bisection.test.ts`) — for a 50 Ω
  target the recovered W produces \|Z₀ − 50\| < 0.05 Ω, which is the
  Phase 5 spec.

For the larger external-reference picture (HFSS / CST / Pozar), see
[`validation.md`](./validation.md).

## 12. Where this stops (v0.1 scope, retained as production path)

- No losses (tan δ, skin effect, surface roughness).
- No dispersion: quasi-static, frequency-independent (KJ post-process
  handles the displayed Z₀(f) dispersion correction).
- Single-ended microstrip only — no differential, CPW, stripline.
- Single substrate layer.

These are conscious omissions for the **main calculator**. v0.2 added
a research-grade full-wave eigenvalue FEM that lifts the dispersion
limit (see §13 below); it's exposed via a separate experimental page
rather than replacing the v0.1 path.

## 13. v0.2 — full-wave eigenvalue FEM (experimental page)

The full-wave path lives under `src/fem-fullwave/` and is reachable
from the "Full-wave (experimental)" page. It solves the mixed
(E_t, E_z) vector-Helmholtz eigenvalue problem on a microstrip
cross-section with an SC-PML truncation, recovering the complex
propagation constant β² directly from Maxwell rather than via a
closed-form correction. End-to-end validation: ε_eff(FEM) matches
KJ to within 0.3 % at f = 20 / 30 GHz on FR-4 — see
[`validation.md`](./validation.md). The inner solver isn't yet
production-ready; the gating items are in [`roadmap.md`](./roadmap.md).

### 13.1 Formulation

For a guided wave with `exp(−jβz)` propagation in a 2-D cross-
section, substituting `∂_z → −jβ` into ∇ × (μ_r⁻¹ ∇ × E) = k₀² ε_r E
and testing with conjugated test functions gives, after the standard
cross-product expansion:

```
  ∫ μ_r⁻¹ (curl_t E_t)(curl_t F_t)*  +  ∫ μ_r⁻¹ ∇E_z · ∇F_z*
  − k₀² ∫ ε_r (E_t · F_t* + E_z F_z*)
  − jβ ∫ μ_r⁻¹ (∇E_z · F_t* − E_t · ∇F_z*)
  = − β² ∫ μ_r⁻¹ E_t · F_t*.
```

The `−jβ` coupling makes this formally quadratic in β. Block-
decomposing on (u, v) = (E_t, E_z), eliminating v from the node
equation, and folding the `−jβ × −jβ = β²` collapse leaves a
**linear generalised eigenvalue problem** on the edge DoFs alone:

```
  K_t u  =  β² M̃ u,    M̃ = M_t − C_tz K_n⁻¹ C_tz^T.
```

This is the Schur reduction implemented in `mixed-assembly.ts` /
`schur.ts` (real path) and `mixed-pml-assembly.ts` /
`complex-schur.ts` (PML path).

### 13.2 Discrete spaces

- **E_t** lives in the Whitney 1-form / Nédélec edge space on
  triangles. The basis function for the edge from vertex `a` to
  vertex `b` is `N_{ab} = λ_a ∇λ_b − λ_b ∇λ_a`, which is
  curl-conforming and gives globally-tangentially-continuous fields
  without forcing normal continuity. 1 DoF per edge, 3 per
  triangle.

- **E_z** lives in the standard P1 nodal Lagrange space — same one
  the quasi-static path uses for φ.

- The discrete gradient operator **G** maps a nodal scalar to its
  edge-DoF gradient. `K_curl · G f = 0` is exact to floating-point
  precision — the discrete curl-grad identity that makes the
  Nédélec construction what it is. The deflator built from G
  filters out the (otherwise spurious) gradient subspace from the
  eigensolver.

### 13.3 SC-PML

The Berenger / Taflove stretched-coordinate PML replaces
`∂/∂x → (1/s_x) ∂/∂x` with `s_x = 1 − jκ_x(x)/ω`. Pulling the s
factors through the curl operator yields effective anisotropic
material tensors:

```
  ε̃     = ε_r · diag(s_y/s_x, s_x/s_y, s_x s_y)
  1/μ̃  = (1/μ_r) · diag(s_y/s_x, s_x/s_y, 1/(s_x s_y))   (zz: K_curl
                                                            coefficient)
```

`pml.ts` produces the per-triangle scalar / tensor weights that the
anisotropic complex assembly modules consume. A polynomial taper
keeps the inner PML boundary reflection-free in the continuous
limit.

### 13.4 Eigensolver

The complex matrix system is **complex symmetric** (A = Aᵀ, but
A ≠ A^H — PML deliberately breaks Hermitian symmetry). The standard
Hermitian Krylov methods (CG, MINRES) decouple their convergence
guarantees from the actual residual norm on complex symmetric
problems, so the inner linear solves go through **complex
Bi-CGSTAB** (Jacobi-preconditioned) and the outer eigsolver is
shift-invert power iteration on the bilinear Rayleigh quotient. See
`complex-eigsolve.ts` for the careful split between bilinear `cdot`
(eigenvalue) and Hermitian `cdotH` (norms / convergence) inner
products.

### 13.5 ε_eff and Z₀ from the eigenpair

```
  ε_eff(f) = β² / k₀²                                 (complex)
  V        = ∫_0^h E_y dy at x = 0                    (line integral)
  P        = ½ Re ∫ (E × H*)_z dA                     (Poynting flux)
  Z₀       = |V|² / (2 P)                              (V-P definition)
```

H is recovered from Maxwell with `exp(−jβz)`:
`H_t = (β/ωμ)(ẑ × E_t) + (j/ωμ)(∇E_z × ẑ)`. The V-P pairing (rather
than V-I or P-I) is chosen because V is a single 1-D line integral
and P is path-independent — both natural to evaluate from the FEM
eigenvector. See `microstrip-z0.ts`.

### 13.6 Why this isn't the main calculator yet

The inner Bi-CGSTAB stagnates whenever the shifted operator
`K_t − σ M̃` lives orders of magnitude below the natural matrix
scale (i.e. low frequencies), and the V-P Z₀ extraction with
1-point quadrature on a coarse mesh sits ~30 % above KJ. Both are
addressable with the items in [`roadmap.md`](./roadmap.md) — an
ILU(0) preconditioner closes the convergence floor, multi-point
quadrature + finer mesh closes the Z₀ gap. Once those land, the
experimental page graduates.
