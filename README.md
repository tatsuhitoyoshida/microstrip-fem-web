# microstrip-fem-web

A 2-D quasi-static finite-element method (FEM) solver for microstrip
characteristic impedance Z₀, running entirely in the browser.

> **Status**: v0.1 — feature-complete, awaiting external HFSS/CST
> validation and corporate styling pass before public launch at
> `tools.photonic-edge.com`.

[日本語版 README](./README.ja.md)

## Why this exists

Most online microstrip calculators rely on Hammerstad–Jensen or Wheeler
closed-form approximations. Those formulas are tightly tuned to thin
conductors, moderate W/h, and quasi-TEM operation; outside that envelope
they drift silently. This tool runs a real PDE solve in the browser, so
the accuracy is governed by the mesh — which we control — rather than
by the regime the formula was fitted for.

## Features (v0.1)

- 2-D quasi-static FEM with linear T3 elements, ~50 k triangles per
  solve by default
- Triangulation by [`triangle-wasm`](https://www.npmjs.com/package/triangle-wasm)
  (Shewchuk's Triangle compiled to WebAssembly)
- Custom Jacobi-preconditioned conjugate-gradient sparse solver in
  TypeScript
- Forward calculation: enter geometry → get Z₀, ε_eff, |E| heatmap
- Inverse design: enter target Z₀ → bisection finds the trace width that
  hits it
- Side-by-side comparison against Hammerstad–Jensen and Wheeler / Pozar
  closed forms
- Interactive cross-section plot with conductor, ground plane, and the
  substrate–air interface clearly marked
- mm / mil unit toggle
- Bilingual UI (Japanese / English) with URL prefix-based language
  detection (`/ja/`, `/en/`)
- All compute is offloaded to a Web Worker so the UI never blocks
- Plotly is loaded lazily — initial JS payload is ~88 kB gzipped

## Quick start

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run test:run     # full Vitest suite
npm run typecheck    # tsc -b --noEmit
npm run build        # production build to dist/
npm run preview      # serve dist/ on http://localhost:4173
```

Node.js v20 LTS or later is required.

## Tech stack

| Area            | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Language        | TypeScript (strict, with `noUncheckedIndexedAccess`)    |
| UI              | React 19                                                |
| Build           | Vite + Rolldown                                         |
| Mesh            | `triangle-wasm`                                         |
| Sparse solver   | Custom CG + Jacobi preconditioner (`src/fem/solver.ts`) |
| Plotting        | `plotly.js-dist-min` (lazy-loaded)                      |
| i18n            | `react-i18next` + `i18next-browser-languagedetector`    |
| Compute offload | Web Worker (`src/workers/femWorker.ts`)                 |
| Tests           | Vitest + Testing Library                                |
| Hosting         | Cloudflare Pages                                        |

## Documentation

- **[`docs/theory.md`](./docs/theory.md)** — the FEM model, weak form,
  T3 element, BCs, capacitance extraction, why CG and not Cholesky, what
  the v0.1 scope deliberately leaves out
- **[`docs/architecture.md`](./docs/architecture.md)** — module map,
  data flow, build chunk sizes, test strategy
- **[`docs/validation.md`](./docs/validation.md)** — automated
  closed-form / textbook agreement, plus a placeholder table for
  manual HFSS / CST cross-checks
- **[`docs/deployment.md`](./docs/deployment.md)** — Cloudflare Pages
  bring-up, custom-domain wiring, rollback
- **[`CLAUDE.md`](./CLAUDE.md)** — the original design spec and
  full per-phase roadmap

## Project structure

```
src/
├── analytical/   # Wheeler / Hammerstad–Jensen closed forms
├── components/   # ParameterForm, ResultsPanel, ComparisonTable, CrossSectionPlot, About, LanguageSwitcher
├── fem/          # geometry, mesh, assembly, boundary, solver, capacitance, tlanalysis, sparse, constants
├── hooks/        # useMicrostripCalc (drives the worker)
├── i18n/         # i18next config + en/ja locale JSON
├── lib/          # mm/mil unit helpers
├── optimization/ # bisection
├── types/        # shared types + ambient module declarations
├── workers/      # femWorker entrypoint + message contract
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

## License

MIT. See [LICENSE](./LICENSE).

## Contributing

Issues and pull requests are welcome. Before opening a substantial PR,
read [CLAUDE.md](./CLAUDE.md) — especially §12 (v0.1 scope-out list)
and §16 (process). The closed-form / textbook tests double as
regression bars for any change to the FEM pipeline.

---

Built by [Photonic Edge Inc.](https://photonic-edge.com) — published at
`tools.photonic-edge.com`.
