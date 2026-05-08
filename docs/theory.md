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

## 12. Where this stops (v0.1 scope)

- No losses (tan δ, skin effect, surface roughness).
- No dispersion: quasi-static, frequency-independent.
- Single-ended microstrip only — no differential, CPW, stripline.
- Single substrate layer.

These are conscious omissions to keep the v0.1 surface honest. See
[CLAUDE.md §12](../CLAUDE.md) for the long list and the rationale for
deferring them.
