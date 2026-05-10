# Full-wave FEM tests (Round 8)

Mirror of `src/fem-fullwave/`. **Empty until Stage 1.**

Planned tests:

| File | Stage | What it pins |
|------|-------|------------|
| `nedelec.test.ts` | 1 | Edge shape function / element matrix correctness on a single triangle |
| `waveguide.test.ts` | 1 | PEC rectangular waveguide: TE10/TE20/TM11 propagation constants vs analytical |
| `eigsolve.test.ts` | 2 | Inverse-iteration convergence on a rectangular waveguide eigenvalue problem |
| `microstrip-fullwave.test.ts` | 4 | Z₀(f) on the four Pozar reference geometries; low-f match to KJ |

## Validation strategy

Stage-by-stage:
- **Stage 1**: closed-form rectangular waveguide TE/TM modes (`β² = (mπ/a)² + (nπ/b)² − k₀²`)
- **Stage 2**: same waveguide, exercise the eigsolver
- **Stage 4**: Pozar microstrip table (FR-4 / RO4350B / RT-duroid / Alumina), low-f
  agreement to KJ correction at the same geometry, high-f trend check
- **Stage 6**: HFSS / CST reference numbers from Tatsy, recorded in
  `docs/validation.md`
