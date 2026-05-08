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
