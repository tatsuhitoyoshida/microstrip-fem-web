# Architecture

This is a single-page Vite + React app whose only non-trivial responsibility
is solving a 2-D quasi-static FEM problem in the browser. There is no
backend: the WebAssembly mesher runs locally and the FEM assembly + CG
solver are pure TypeScript on a Web Worker thread.

```
                                 main thread
              ┌────────────────────────────────────────────────────────┐
              │                                                        │
   user ────► │  ParameterForm  ──► useMicrostripCalc  ──► postMessage │
              │       ▲                   │                      │     │
              │       │                   ▼                      │     │
              │       │            CrossSectionPlot (Plotly)     │     │
              │       │            ResultsPanel                  │     │
              │       │            ComparisonTable               │     │
              │       │            About / LanguageSwitcher      │     │
              │       └─────────────── result ◄──────────────────┘     │
              │                                                        │
              └────────────────────────────────────────────────────────┘
                                                       │
                                                       │  postMessage
                                                       ▼
              ┌────────────────────────────────────────────────────────┐
              │                  femWorker (Worker)                    │
              │                                                        │
              │  initMesh (triangle-wasm, lazy)                        │
              │     │                                                  │
              │     ▼                                                  │
              │  buildMicrostripPslg ─► meshFromPslg                   │
              │                            │                           │
              │                            ▼                           │
              │  assembleK ─► applyDirichletElimination ─► solveCgJacobi
              │                                                  │     │
              │                            ┌─────────────────────┘     │
              │                            ▼                           │
              │                    capacitancePerLength                │
              │                            │                           │
              │                            ▼                           │
              │                  characteristicImpedance               │
              │                  effectivePermittivity                 │
              │                            │                           │
              │                            ▼                           │
              │  hammerstadJensen / wheeler  (closed-form, comparison) │
              │                                                        │
              │  findOptimalWidth (bisection wraps the chain above)    │
              │                                                        │
              └────────────────────────────────────────────────────────┘
```

## Module map

| Path                                         | Role                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`                               | React entrypoint; loads i18n then mounts `<App />`.                                                      |
| `src/App.tsx`                                | Top-level layout (form / plot / results grid + header).                                                  |
| `src/components/ParameterForm.tsx`           | W, h, t, εr, target Z₀ inputs + mm/mil toggle + Calculate / Find-W buttons.                              |
| `src/components/CrossSectionPlot.tsx`        | Plotly heatmap of \|E\| with conductor / ground / interface overlays. Loads `plotly.js-dist-min` lazily. |
| `src/components/ResultsPanel.tsx`            | FEM Z₀, ε_eff, capacitance, mesh diagnostics.                                                            |
| `src/components/ComparisonTable.tsx`         | FEM vs Hammerstad–Jensen vs Wheeler.                                                                     |
| `src/components/About.tsx`                   | Why-FEM / scope / license / GitHub.                                                                      |
| `src/components/LanguageSwitcher.tsx`        | JA / EN toggle, updates URL prefix.                                                                      |
| `src/hooks/useMicrostripCalc.ts`             | Owns the worker, request-id ↔ Promise multiplexing, loading + error state.                               |
| `src/workers/femWorker.ts`                   | Worker entrypoint. Routes `forward` / `findW` requests to the FEM pipeline.                              |
| `src/workers/messages.ts`                    | Request / response type contract shared by hook and worker.                                              |
| `src/fem/geometry.ts`                        | Builds a PSLG (vertices, segments, holes, region attributes) from microstrip params.                     |
| `src/fem/mesh.ts`                            | `triangle-wasm` wrapper: lazy WASM init, runs the triangulation, copies the result off the heap.         |
| `src/fem/assembly.ts`                        | T3-element stiffness assembly; emits a CSR matrix.                                                       |
| `src/fem/sparse.ts`                          | COO → CSR builder, SpMV, dot, axpy, etc.                                                                 |
| `src/fem/boundary.ts`                        | Dirichlet row/column elimination for CG-friendly conditioning.                                           |
| `src/fem/solver.ts`                          | Jacobi-preconditioned conjugate-gradient solver.                                                         |
| `src/fem/capacitance.ts`                     | Energy-method capacitance extraction.                                                                    |
| `src/fem/tlanalysis.ts`                      | Z₀ / ε_eff orchestration; runs two FEM solves (with dielectric, in vacuum).                              |
| `src/fem/constants.ts`                       | Physical constants (c, μ₀, ε₀, η₀).                                                                      |
| `src/optimization/bisection.ts`              | HJ-seeded bisection on Z₀(W) for inverse design.                                                         |
| `src/analytical/hammerstad.ts`               | Hammerstad–Jensen 1980 closed form.                                                                      |
| `src/analytical/wheeler.ts`                  | Wheeler / Pozar closed form.                                                                             |
| `src/analytical/...`                         | Used both as comparison values and as bisection seeds.                                                   |
| `src/i18n/`, `src/i18n/locales/{en,ja}.json` | i18next config + UI strings.                                                                             |
| `src/lib/units.ts`                           | mm ↔ mil helpers.                                                                                        |
| `src/types/index.ts`                         | Shared types (`MicrostripParams`, `Mesh`, `Pslg`, marker / region enums, …).                             |
| `public/triangle.out.wasm`                   | Static WASM asset served at the site root.                                                               |

### Full-wave PML module (research, not in UI yet)

The `src/fem-fullwave/` tree implements a complete vector full-wave
eigenvalue FEM with SC-PML truncation. It does not currently feed the
production UI (`useMicrostripCalc` → quasi-static FEM + KJ
post-process is still the production path for v0.2) — see
`docs/roadmap.md` for the gating preconditioner work.

| Path                                           | Role                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/fem-fullwave/edge-dofs.ts`                | Edge-DoF enumeration + orientation for Nédélec elements.                                            |
| `src/fem-fullwave/nedelec.ts`                  | Whitney 1-form element matrices (curl-curl, vector mass).                                           |
| `src/fem-fullwave/vector-assembly.ts`          | Real-isotropic edge-DoF block assembly (homogeneous / dielectric-loaded paths).                     |
| `src/fem-fullwave/assembly.ts`                 | Real-weight P1 nodal stiffness + mass (scalar block).                                               |
| `src/fem-fullwave/boundary.ts`                 | PEC-restriction utilities (real and complex variants).                                              |
| `src/fem-fullwave/gradient.ts`                 | Discrete gradient operator G + M-orthogonal deflator.                                               |
| `src/fem-fullwave/eigsolve.ts`                 | Inverse-iteration + shift-invert MINRES eigensolver for real symmetric GEPs.                        |
| `src/fem-fullwave/minres.ts`                   | Real symmetric indefinite linear solver (Paige-Saunders).                                           |
| `src/fem-fullwave/mixed-assembly.ts`           | Real (E_t, E_z) block assembly with Schur convention.                                               |
| `src/fem-fullwave/schur.ts`                    | M̃ = M_t − C_tz K_n⁻¹ C_tz^T (real) via inner CG.                                                    |
| `src/fem-fullwave/complex-sparse.ts`           | Complex CSR + interleaved storage + `cdot` / `cdotH` inner products.                                |
| `src/fem-fullwave/complex-solver.ts`           | Complex Bi-CGSTAB with Jacobi preconditioning.                                                      |
| `src/fem-fullwave/complex-vector-assembly.ts`  | Anisotropic / complex edge-DoF blocks (curl-curl, mass, coupling).                                  |
| `src/fem-fullwave/complex-scalar-assembly.ts`  | Anisotropic / complex P1 nodal blocks.                                                              |
| `src/fem-fullwave/complex-eigsolve.ts`         | Shift-invert eigensolver on complex symmetric GEPs.                                                 |
| `src/fem-fullwave/complex-schur.ts`            | Complex M̃ via inner Bi-CGSTAB.                                                                      |
| `src/fem-fullwave/complex-gradient.ts`         | Complex M-orthogonal gradient deflator.                                                             |
| `src/fem-fullwave/pml.ts`                      | SC-PML 1-D profiles + 2-D Cartesian config + tensor-weight factories.                               |
| `src/fem-fullwave/mixed-pml-assembly.ts`       | PML-aware (E_t, E_z) block assembly.                                                                |
| `src/fem-fullwave/pml-eigensolve.ts`           | End-to-end PML pipeline wrapper (assemble → restrict → Schur → deflate → eigsolve → recover E_z).   |
| `src/fem-fullwave/microstrip-pml.ts`           | Microstrip geometry → triangle-wasm mesh → PML pipeline → β².                                       |
| `src/fem-fullwave/microstrip-z0.ts`            | ε_eff(f) + Z₀ (V-P definition) from the converged eigenpair.                                        |

## Data flow for a single forward calculation

1. The user fills `ParameterForm` and presses **Calculate**.
2. `App.tsx` calls `computeForward(params)` on the `useMicrostripCalc`
   hook.
3. The hook posts `{ id, type: 'forward', params }` to the FEM worker and
   marks the result panel as loading.
4. The worker:
   - lazy-initialises `triangle-wasm` on first request,
   - calls `buildMicrostripPslg → meshFromPslg → assembleK →
applyDirichletElimination → solveCgJacobi → capacitancePerLength`
     once with εr in the substrate region, and a second time with εr ≡ 1
     (vacuum), then derives Z₀ and ε_eff,
   - also calls `hammerstadJensen` and `wheeler` for the comparison
     panel,
   - sends `{ id, type: 'forward-result', fem, hammerstad, wheeler,
paramsUsed }` back.
5. The hook resolves the pending Promise, drops the result into React
   state, and the three right-hand panels rerender. `CrossSectionPlot`
   dynamically imports Plotly the first time a result arrives.

`findOptimalW` follows the same shape but the worker first runs a
coarse-mesh bisection (`solveOptions.geometry.{substrateMaxArea,
airMaxArea}` overrides) before doing one final report-quality solve at
the recovered W.

## Build pipeline (Vite + Rolldown)

`npm run build` produces three significant chunks:

| Chunk             | Approx. size | Purpose                                                                                                                      |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `index-*.js`      | ~88 kB gzip  | App shell, i18n, hook, all FEM TypeScript that runs on the worker is inlined here too — but only loaded by the worker entry. |
| `femWorker-*.js`  | ~24 kB       | Worker entrypoint chunk.                                                                                                     |
| `plotly.min-*.js` | ~1.4 MB gzip | Loaded on first Calculate via dynamic import inside `CrossSectionPlot`.                                                      |

`triangle.out.wasm` is copied from `node_modules/triangle-wasm` into
`public/` and shipped as-is (125 kB).

## Test strategy

| Test file                         | Coverage                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `tests/analytical.test.ts`        | Wheeler / HJ closed-form vs textbook 50 Ω targets within ±2–3 %.                  |
| `tests/sparse.test.ts`            | COO → CSR compaction, SpMV, vector ops.                                           |
| `tests/solver.test.ts`            | CG solves a 2×2 SPD system, a 1-D Laplacian, rejects non-SPD.                     |
| `tests/geometry.test.ts`          | PSLG vertex/segment counts, hole position, region attributes, marker coverage.    |
| `tests/mesh.test.ts`              | triangle-wasm integration, min angle ≥ 25 °, region tagging, marker preservation. |
| `tests/parallel-plate.test.ts`    | Phase 3 completion criterion: parallel-plate FEM matches ε₀ · W / h within 1 %.   |
| `tests/microstrip.test.ts`        | Phase 4 completion criterion: full FEM matches Hammerstad–Jensen within 2 %.      |
| `tests/bisection.test.ts`         | Phase 5 completion criterion: 50 Ω target → \|Z₀ − 50\| < 0.05 Ω.                 |
| `tests/components.smoke.test.tsx` | UI components mount without throwing.                                             |
| `tests/units.test.ts`             | mm ↔ mil round-trip + formatting.                                                 |

### Full-wave PML test files

| Test file                                       | Coverage                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `tests/fem-fullwave/nedelec.test.ts`            | Whitney 1-form element matrices, curl identity, mass / curl-curl symmetry.    |
| `tests/fem-fullwave/vector-assembly.test.ts`    | Global edge-DoF assembly: symmetry, ∇×constant = 0, coupling block shape.     |
| `tests/fem-fullwave/eigsolve.test.ts`           | Inverse-iteration eigensolver on toy real-symmetric GEPs.                     |
| `tests/fem-fullwave/minres.test.ts`             | Real MINRES on symmetric indefinite systems.                                  |
| `tests/fem-fullwave/gradient.test.ts`           | Discrete curl-grad identity, deflator idempotency + M-orthogonality.          |
| `tests/fem-fullwave/shift-invert.test.ts`       | Real shift-invert eigensolver including with the deflator.                    |
| `tests/fem-fullwave/closed-waveguide.test.ts`   | TE_10 in closed PEC 2×1 box matches `(π/a)²`; mesh refinement.                |
| `tests/fem-fullwave/mixed-waveguide.test.ts`    | Mixed system Schur: homogeneous + dielectric-loaded closed box.               |
| `tests/fem-fullwave/complex-sparse.test.ts`     | Complex CSR, both inner products, transpose vs adjoint, BLAS-1 ops.           |
| `tests/fem-fullwave/complex-solver.test.ts`     | Complex Bi-CGSTAB: real SPD, complex symmetric, non-symmetric, indefinite.    |
| `tests/fem-fullwave/complex-vector-assembly.test.ts` | Anisotropic / complex edge-DoF blocks reduce to real isotropic at κ=0.   |
| `tests/fem-fullwave/complex-scalar-assembly.test.ts` | Same for P1 nodal blocks.                                                 |
| `tests/fem-fullwave/pml.test.ts`                | SC-PML profiles + weight factories + `noPml()` reduction.                     |
| `tests/fem-fullwave/mixed-pml-assembly.test.ts` | PML-aware 4-block assembly reduces to real path at κ=0.                       |
| `tests/fem-fullwave/complex-eigsolve.test.ts`   | Complex shift-invert eigensolver on synthetic complex symmetric GEPs.         |
| `tests/fem-fullwave/closed-waveguide-pml.test.ts` | End-to-end κ=0 pipeline through PML reproduces real-path β².                |
| `tests/fem-fullwave/pml-eigensolve.test.ts`     | `solveMixedSystemPml` wrapper regression on closed-domain answers.            |
| `tests/fem-fullwave/microstrip-pml.test.ts`     | FR-4 microstrip @ 20 GHz: ε_eff vs KJ-dispersive, V-P Z₀ smoke test.          |
| `tests/fem-fullwave/microstrip-dispersion.test.ts` | FR-4 multi-frequency (20 / 30 GHz): ε_eff(f) tracks KJ within 0.3 %.       |
