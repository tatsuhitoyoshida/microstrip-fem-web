# research/

Shelved code for the v0.2 full-wave PML eigensolver. **Not part of
the production build.** The main app at `src/` ships only the
quasi-static FEM + Kirschning–Jansen post-process; this directory
preserves the experimental vector-Helmholtz path so development can
resume later.

## Why this is shelved

The math pipeline was end-to-end validated (`ε_eff(FEM)` matches KJ
within 0.3 % at 20 / 30 GHz on FR-4), but two practical limitations
made the UI integration untrustworthy enough to pull from the
production calculator:

1. **Inner solver stagnates below ~20 GHz** on the coarse mesh the
   Web Worker uses. The Jacobi-PCG inner solve inside complex
   Bi-CGSTAB needs a stronger preconditioner (ILU(0) on complex
   symmetric matrices) to make low-frequency convergence reliable.

2. **Z₀ absolute accuracy ~30 %** on the same coarse mesh, even when
   ε_eff is right to 3 digits. The V-line integral with 1-point
   midpoint quadrature is the dominant error source; multi-point
   Gauss quadrature on a finer mesh closes it, but the inner solver
   has to get faster first.

Both are listed in `docs/roadmap.md` under "v0.3 — full-wave
production readiness".

## What's here

```
research/
├── src/
│   ├── fem-fullwave/        # the math: Whitney 1-form edge elements,
│   │                        # SC-PML, Schur reduction, complex
│   │                        # symmetric Bi-CGSTAB + shift-invert
│   ├── components/
│   │   └── FullWavePage.tsx # the UI page (hard-coded English text)
│   ├── hooks/
│   │   └── useFullWaveCalc.ts
│   └── workers/
│       ├── messages.ts      # research-only message shapes
│       └── researchWorker.ts# self-contained `fullwave` route
└── tests/
    ├── fem-fullwave/        # 19 numerical-correctness test files
    └── fullwave-page.smoke.test.tsx
```

The math modules under `research/src/fem-fullwave/` are fully
self-contained except they import from `../../../src/{types,fem,
analytical}/` for shared primitives (sparse-matrix utilities, KJ
formulas, mesh types). Those dependencies stay in `src/` so the
production code can rely on them.

## Running the research suite

```bash
npm run test:research        # 113 tests, ~16 s
npm run typecheck:research   # checks research/ against src/
```

The default `npm test` and `npm run typecheck` paths only cover
production code; running them won't touch `research/`.

## Resuming development

To wire the full-wave page back into the production UI:

1. Add `FullWavePage` import + a `view` state to `src/App.tsx`
   (the previous version is in commit `ebef1e1` / before the
   "shelf" commit if you want to crib from it).
2. Add a header navigation button.
3. Optionally restore the `fullwave.*` keys to `src/i18n/locales/`
   and undo the hard-coded English in `FullWavePage.tsx`.
4. Drop the low-frequency disclaimer + 30 % Z₀ warning *only* after
   the v0.3 roadmap items land (ILU(0), multi-point quadrature).

The worker is already self-contained (`research/src/workers/
researchWorker.ts`) so no production-worker changes are needed.

## Provenance

- Branch: developed on `feat/full-wave-fem`
- Last validated: 187 tests across 33 files green before the
  shelving refactor (see commit `ebef1e1`).
- Theory: `docs/theory.md` §13 (English) / `docs/theory.ja.md` §13
  (Japanese).
- Validation: `docs/validation.md` "v0.2 — Full-wave PML pipeline".
- Roadmap: `docs/roadmap.md` v0.3 section.
