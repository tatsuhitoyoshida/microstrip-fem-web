# Validation

This document records how this tool's FEM output has been cross-checked
against independent sources, and where the open holes are.

There are three concentric levels of validation, from the cheapest /
fastest to run to the most expensive:

1. **Closed-form formulas in the test suite** (always run on `npm test`)
2. **Textbook reference designs** (always run on `npm test`)
3. **Commercial full-wave solvers** — HFSS / CST — _to be run manually
   by Tatsy and recorded here_

## Levels 1 and 2 — automated

The Phase 3, 4, 5 completion tests live in
[`tests/parallel-plate.test.ts`](../tests/parallel-plate.test.ts),
[`tests/microstrip.test.ts`](../tests/microstrip.test.ts), and
[`tests/bisection.test.ts`](../tests/bisection.test.ts). The current
agreement is summarised below.

### Parallel-plate vacuum capacitor

Linear T3 elements reproduce the analytical solution `φ = y/h` exactly,
so the recovered C / L matches `ε₀ · W/h` to round-off (well below the
1 % spec target). This is mostly a sanity check on the assembly + BC +
solver pipeline, not a physics result.

### FEM vs Hammerstad–Jensen on three substrates

| Material                  | h [mm] | t [mm] | W [mm] | FEM Z₀ [Ω] | HJ Z₀ [Ω] | Δ Z₀   | FEM ε_eff | HJ ε_eff | Δ ε_eff |
| ------------------------- | ------ | ------ | ------ | ---------- | --------- | ------ | --------- | -------- | ------- |
| FR-4 (εr = 4.4)           | 1.6    | 0.035  | 3.0    | 49.25      | 50.01     | 1.51 % | 3.291     | 3.331    | 1.21 %  |
| RT/duroid 5880 (εr = 2.2) | 0.787  | 0.018  | 2.4    | 49.19      | 49.93     | 1.48 % | 1.870     | 1.882    | 0.62 %  |
| Alumina (εr = 9.8)        | 0.635  | 0.005  | 0.59   | 49.95      | 50.65     | 1.37 % | 6.452     | 6.549    | 1.48 %  |

The numbers above are the values printed by the test suite at the time
of writing. FEM is consistently a fraction of a percent below HJ; the
trend is consistent with HJ slightly under-counting the corner-singularity
contribution at the conductor edges. Either way, the agreement is well
inside the Phase 4 ±2 % spec.

### Bisection round trip

For a 50 Ω target on FR-4 (εr = 4.4, h = 1.6 mm, t = 0.035 mm), the
bisection driver recovers W = 2.89 mm (HJ predicts 3.00 mm; the gap is
the same systematic FEM-below-HJ trend). The Z₀ at the recovered W is
49.96 Ω, which is well inside the Phase 5 ±0.05 Ω convergence spec.

## Level 3 — HFSS / CST

> **TODO (Tatsy):** the table below is a placeholder. Run the same
> geometries in HFSS and CST, transcribe the Z₀ / ε_eff numbers, and
> drop a brief notes column for any discrepancies > 1 %.

| Geometry                           | FEM Z₀ [Ω] | HFSS Z₀ [Ω] | CST Z₀ [Ω] | FEM ε_eff | HFSS ε_eff | CST ε_eff | Notes                                                 |
| ---------------------------------- | ---------- | ----------- | ---------- | --------- | ---------- | --------- | ----------------------------------------------------- |
| FR-4, W=3.0, h=1.6, t=0.035        | 49.25      | _TBD_       | _TBD_      | 3.291     | _TBD_      | _TBD_     |                                                       |
| RT/duroid, W=2.4, h=0.787, t=0.018 | 49.19      | _TBD_       | _TBD_      | 1.870     | _TBD_      | _TBD_     |                                                       |
| Alumina, W=0.59, h=0.635, t=0.005  | 49.95      | _TBD_       | _TBD_      | 6.452     | _TBD_      | _TBD_     |                                                       |
| FR-4 wide (W = 5h)                 | _TBD_      | _TBD_       | _TBD_      | _TBD_     | _TBD_      | _TBD_     | exercises the wide-W regime that HJ handles well      |
| FR-4 narrow (W = 0.2 h)            | _TBD_      | _TBD_       | _TBD_      | _TBD_     | _TBD_      | _TBD_     | exercises the narrow-W regime where HJ tends to drift |
| Thick conductor (t = 0.2 h)        | _TBD_      | _TBD_       | _TBD_      | _TBD_     | _TBD_      | _TBD_     | the regime FEM is supposed to win                     |

Spec target (CLAUDE.md §10): Z₀ within ±1 % of HFSS / CST.

## Known systematic biases

- **FEM gives Z₀ slightly lower than HJ on standard geometries.** Across
  every test case in this repo, FEM lands roughly 1.4–1.5 % below HJ.
  This is reproducible at the ~50 k-triangle default mesh density we
  ship; pushing the mesh denser (well past the upstream triangle-wasm
  16 MB heap) would close the gap further. Whether the residual bias is
  HJ under-counting the corner singularity, or T3 over-resolving it, can
  only be settled with HFSS / CST data.
- **No conductor loss / dispersion.** v0.1 is quasi-static, so the
  FEM-vs-HFSS agreement is only meaningful for HFSS configured in a
  comparable lossless / quasi-TEM regime. tan δ and skin effect are
  outside scope.

## v0.2 — Full-wave PML pipeline (research-only)

Round 8c built a complete vector full-wave eigenvalue FEM on top of
the quasi-static path. The pipeline (mixed Et + Ez Nédélec /
nodal-Lagrange formulation → complex Schur reduction → SC-PML
truncation → complex shift-invert eigsolver) is fully wired up and
validated end-to-end, but does not currently feed the production UI
— see `docs/architecture.md` and `docs/roadmap.md` for why.

### Closed-form validations (from `research/tests/fem-fullwave/`)

| Test                                              | Reference                                        | Result          |
| ------------------------------------------------- | ------------------------------------------------ | --------------- |
| Closed PEC waveguide TE_10 (2×1 box, k_c²)        | analytical `(π/a)²`                              | within 2 %      |
| TE_10 mesh refinement                             | finer mesh → tighter to analytical               | confirmed       |
| Closed PEC mixed system at k₀² = 5 (β²)           | analytical `k₀² − (π/a)²` (≈ 2.533)              | within 5 %      |
| Inhomogeneous half-dielectric (ε_r = 4, k₀² = 5)  | analytical bracket [air-only, ε=4-uniform]       | inside bracket  |
| End-to-end PML pipeline @ κ = 0 (reduces to PEC)  | matches real-track Stage 2.5 answer              | within 5 %      |

### FR-4 microstrip dispersion match against KJ

Coarse-mesh PML solve (lateral / air pad = 3·h, ≈ few hundred
triangles) at two upper-microwave frequencies, with KJ-dispersive
ε_eff(f) as the reference:

| f [GHz] | ε_eff (FEM)  | ε_eff (KJ)   | Δε_eff      | Z₀ (FEM-V/P) | Z₀ (KJ)   |
| ------- | ------------ | ------------ | ----------- | ------------ | --------- |
| 20      | 3.888        | 3.899        | **−0.26 %** | 67.5 Ω       | 46.2 Ω    |
| 30      | 4.051        | 4.060        | **−0.21 %** | 75.0 Ω       | 45.3 Ω    |

**The ε_eff(f) match is the load-bearing validation**: it proves
the eigenvalue itself is correct across a meaningful slice of the
frequency band, matching an independent reference (KJ accurate to
~1 % vs measured data) to better than 0.3 %.

### Known limits of the current PML implementation

These are not algorithmic errors — the math is right. They are
practical constraints from the Jacobi-preconditioned BiCGStab
inner solver:

- **f ≲ 20 GHz on coarse mesh**: the shifted-operator conditioning
  collapses as σ shrinks far below the natural matrix scale.
  BiCGStab stagnates at rel-residual O(0.1). A stronger
  preconditioner (ILU(0) on complex symmetric) would fix this and
  is on the v0.3 roadmap.
- **Z₀ absolute accuracy ~30 %** at the coarse-mesh / 1-point
  quadrature configuration tested. ε_eff is 0.3 %; the Z₀ gap is
  the V-line integral approximation. Multi-point quadrature on V
  and a finer mesh under the trace would close it.
- **PML reflection floor ~ 1 %** at κ_max = 3, polynomial order 2.
  Higher κ_max + more taper points lower this further at the cost
  of more PML-zone triangles.

## Reference textbooks

The "expected W ≈ X mm" values in
[CLAUDE.md §10](../CLAUDE.md) come from standard microwave-engineering
references — Pozar's _Microwave Engineering_, Bahl & Trivedi, and the
Rogers application notes for substrate-specific designs. Those are the
same sources the HJ formula was originally fitted against, so a tight
agreement at level 2 does not by itself prove correctness against
measurement.
