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

## Reference textbooks

The "expected W ≈ X mm" values in
[CLAUDE.md §10](../CLAUDE.md) come from standard microwave-engineering
references — Pozar's _Microwave Engineering_, Bahl & Trivedi, and the
Rogers application notes for substrate-specific designs. Those are the
same sources the HJ formula was originally fitted against, so a tight
agreement at level 2 does not by itself prove correctness against
measurement.
