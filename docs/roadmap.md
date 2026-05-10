# Roadmap

What's in v0.2 and what's deferred. Anything described as v0.3+ here is
*not* in scope for the current release — open an issue or PR to discuss
before starting work.

## v0.1 — public-launch baseline (released)

- 2-D quasi-static FEM (Jacobi-PCG, linear T3 elements) running in a
  Web Worker
- Adaptive refinement, target ~50 k triangles, sub-second on FR-4
- KJ closed-form post-process for ε_eff(f) and Z₀(f)
- Inverse design (Z₀ → W) via bisection
- Simple / Advanced UI modes, JA / EN bilingual
- HJ + Wheeler comparison panels
- SweepChart with KJ-corrected Z₀(f) overlay

## v0.2 — full-wave PML math (shelved under `research/`)

The whole vector-Helmholtz Nédélec + SC-PML pipeline lives under
[`research/src/fem-fullwave/`](../research/). It was wired into the
UI via a "Full-wave (experimental)" page during development but
pulled before v0.2 release: ε_eff(FEM) matched KJ to better than
0.3 % but absolute Z₀ on a UI-fast mesh sat ~30 % off, which would
mislead users more than help them. The math, tests, and the UI
scaffolding (page + hook + worker) are preserved so resuming
development is a wire-up exercise, not a rebuild. See
[`research/README.md`](../research/README.md) for the resume
checklist; production scripts opt in via
`npm run test:research` and `npm run typecheck:research`.

What's *in* `research/`:

- Real & complex sparse infrastructure (CSR, CooBuilder, BLAS-1)
- MINRES (real symmetric indefinite) and Bi-CGSTAB (complex)
- Discrete-gradient operator G + M-orthogonal deflator (both real
  and complex)
- Shift-invert eigensolvers (real and complex symmetric)
- Mixed (E_t, E_z) block assembly + Schur reduction (real & PML)
- SC-PML profile + tensor-weight derivation
- End-to-end FR-4 dispersion validation: ε_eff(f) matches KJ
  within 0.3 % at f = 20 / 30 GHz
- `FullWavePage` + `useFullWaveCalc` + a self-contained
  `researchWorker` so the page works once it's re-imported into
  `App.tsx`

What's *not* in `research/` but **is on the v0.3 list below**:
production-quality Z₀ extraction, low-frequency convergence, a
stronger inner preconditioner, and the UI integration that would
let the full-wave path replace the KJ post-process in the main
calculator.

## v0.3 — full-wave production readiness

These are the gating items that would let the full-wave path
graduate from `Full-wave (experimental)` page to the main calculator.

### Numerical solver

- **ILU(0) preconditioner for complex symmetric matrices.** The
  Jacobi-PCG inner solver currently used inside the complex
  Bi-CGSTAB stagnates whenever the shifted operator (K − σ M) sits
  far below the natural matrix scale — which happens for any
  frequency where σ ≪ k_curl-curl eigenvalues. ILU(0) on the
  symbolic sparsity pattern would close that gap. Estimated effort:
  1–2 weeks (clean implementation + symbolic factorisation +
  apply step + tests vs the existing Jacobi path).
- **Direct-solver fallback** (sparse Cholesky for SPD blocks,
  sparse LDLᵀ for complex symmetric). Lets the Schur K_n⁻¹·C_tzᵀ
  inner solves replay much faster on repeated RHS — currently every
  edge column does its own iterative BiCGStab cold-start. v0.3
  might just plug a clean WASM build of UMFPACK or eigen-js
  rather than rolling our own.
- **Continuation in σ for low-frequency robustness.** Rather than
  one shot at σ ≈ k₀² · ε_eff_KJ, sweep σ from the cavity-mode
  region down to the target. Each step uses the previous
  eigenvector as the warm start; the shift never strays too far
  from a known eigenvalue. Closes the f < 20 GHz hole at modest
  extra cost.

### Z₀ extraction accuracy

- **Multi-point Gauss quadrature** on the V line integral and the
  P cross-section integral. The current 1-point centroid quadrature
  is the dominant source of the ~30 % absolute-Z₀ error.
- **Surface-current I from the conductor boundary loop**, rather
  than the V-P proxy. Requires triangle-adjacency around the
  conductor PEC segments, which the mesh emitter already provides
  but the extraction module doesn't consume yet.
- **Mode identification** for hybrid modes (microstrip near
  multi-mode cutoff). Currently shift-invert assumes the dominant
  mode at σ ≈ k₀² · ε_eff_KJ is quasi-TEM; need a Poynting-flux
  sign / shape check for higher-order modes.

### UI integration

- **Merge experimental + main**, with a "solver: KJ / full-wave"
  selector inside the existing parameter form once full-wave is
  production-quality. Drop the separate page once it's no longer
  needed.
- **Full-wave SweepChart trace** showing Z₀(f) from FEM
  eigenvalues across a band (today's chart uses KJ).
- **Cross-section heatmap from the full-wave eigenvector** so the
  user can see the bound microstrip mode rather than the static-
  potential proxy.

### Stretch

- **3-D extensions** for non-uniform structures (T-junctions,
  step-in-width). Same Nédélec elements, full 3-D mesh, MUCH
  bigger problem — likely a v0.4 effort.
- **Eigenvalue continuation** along a parameter sweep (e.g. f or
  W) so each adjacent solve warm-starts the previous.

## Out of scope indefinitely

- Conductor / dielectric loss (tan δ, skin effect, surface
  roughness). Would extend ε_r, μ_r to complex constants and
  introduce α propagation constant — substantial weak-form rework.
  Currently expected in v0.4 if there's user demand.
- Differential pairs, CPW, stripline, SIW — different boundary /
  geometry topologies. Plausible v0.5 work but no commitment.
- Touchstone (.s2p) export, frequency sweeps with full-wave at
  every point. Worker can't currently sustain that throughput;
  needs the v0.3 preconditioner work first.
