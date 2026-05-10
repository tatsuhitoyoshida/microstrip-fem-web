# Full-wave FEM module (Round 8)

This directory holds the v0.2 full-wave eigenvalue FEM solver. **Empty
scaffolding** at the moment — populated stage-by-stage following the plan
in `~/.claude/plans/gui-photonic-edge-pure-breeze.md` (Round 8 section).

## What lives here (planned)

| File | Stage | Purpose |
|------|-------|---------|
| `edge-dofs.ts` | 1 | Edge enumeration + orientation map for Nédélec elements |
| `nedelec.ts` | 1 | Whitney 1-form shape functions, element matrices |
| `assembly.ts` | 1 | Global block matrices A_tt / A_tz / A_zt / A_zz / B_tt / B_zz |
| `eigsolve.ts` | 2 | Generalised eigenvalue solver (shift-invert inverse iteration → Lanczos) |
| `mode.ts` | 4 | Dominant quasi-TEM mode identification |
| `z0.ts` | 4 | Power-Current Z₀ extraction |
| `solve.ts` | 4 | High-level entry point |

## Why a separate directory

Existing `src/fem/` is the quasi-static (Laplace) solver — production v0.1.
Full-wave is a different mathematical problem (curl-curl eigenvalue) and
needs different element types (edge, not nodal scalar). Keeping the
implementations parallel rather than entangled lets us:

1. Ship a v0.2 with full-wave without breaking v0.1's static endpoint
2. Roll back individual stages cleanly (just delete files in this dir)
3. Re-validate the full-wave path against KJ at low f without code shared
   between the two

## Status

- **Stage 0** (current): scaffolding only, no code, no behaviour change
- **Stage 1**: Nédélec elements + waveguide validation
- **Stage 2**: eigenvalue solver
- **Stage 3**: open boundary handling
- **Stage 4**: microstrip integration
- **Stage 5**: UI / Worker hookup
- **Stage 6**: validation against HFSS / Pozar values

See the plan file for detailed stage gates and rollback procedure.
