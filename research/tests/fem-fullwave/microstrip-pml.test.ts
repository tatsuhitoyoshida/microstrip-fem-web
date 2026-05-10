// @vitest-environment node
/**
 * Microstrip PML integration smoke test (Round 8c Stage 3a-vi-b).
 *
 * Runs the full pipeline (geometry → mesh → PML eigensolve) on a
 * coarse FR-4 cross-section and verifies the recovered β² is close
 * to the quasi-static estimate `k₀² · ε_eff(KJ-static)`. This is
 * intentionally a smoke test, not an accuracy test:
 *
 *   - the mesh is coarse (tiny lateral / air padding, large per-region
 *     max areas) to keep the run-time bounded — Schur complement
 *     assembly is `numEdges` complex BiCGStab inner solves, each on a
 *     Laplacian-sized complex system;
 *   - the PML on this coarse mesh has only a couple of triangles in
 *     the absorbing zone, so its absorption is qualitative at best;
 *   - we only assert that β² is in the right *order of magnitude* and
 *     reasonably close to `k₀² · ε_eff_KJ`, not that it matches to
 *     percent precision.
 *
 * Real-percentage accuracy validation against KJ / Pozar comes in
 * Stage 3a-vi-d, with finer meshes and the proper Z₀ extraction.
 */

import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { solveMicrostripPml } from '../../src/fem-fullwave/microstrip-pml';
import { extractMicrostripZ0 } from '../../src/fem-fullwave/microstrip-z0';
import { initMesh, _resetInitForTesting } from '../../../src/fem/mesh';
import { hammerstadJensen } from '../../../src/analytical/hammerstad';
import type { MicrostripParams } from '../../../src/types';

const C_MM_PER_S = 2.998e11;

const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

const FR4: MicrostripParams = {
  width: 3.0,
  height: 1.6,
  thickness: 0.035,
  epsilonR: 4.4,
};

describe('Microstrip PML pipeline — coarse FR-4 smoke test', () => {
  beforeAll(async () => {
    _resetInitForTesting();
    await initMesh(WASM_PATH);
  });

  it('FR-4 at 20 GHz produces β² in the right ballpark of k₀² · ε_eff_KJ', async () => {
    // Pick 20 GHz so k₀ · h ≈ 0.67 — large enough that the shifted
    // operator (K_t − σ M̃) isn't dominated by the rank-deficient
    // curl-curl. Even so, BiCGStab on the indefinite complex
    // symmetric system stagnates with σ exactly at the target
    // eigenvalue (singular shifted matrix). Three remediation
    // tactics combined here:
    //
    //   1. Shift slightly *off* the target — `σ_re = 1.3 · k₀² ·
    //      ε_eff_KJ` keeps it close enough for shift-invert to lock
    //      onto the right mode but far enough that (A − σB) isn't
    //      near-singular.
    //
    //   2. Add a small **imaginary** shift (`σ_im = 0.3 · k₀²`) —
    //      moves the operator off the real axis, where complex-
    //      symmetric BiCGStab is much better behaved.
    //
    //   3. Bump `innerMaxIter` — even with the better-conditioned
    //      shift, BiCGStab on this size matrix needs more iterations
    //      than the default `4·n`.
    const fGHz = 20;
    const k0 = (2 * Math.PI * fGHz * 1e9) / C_MM_PER_S;
    const k0sq = k0 * k0;
    const epsEff = hammerstadJensen(FR4).epsilonEff;
    // 1.3× target real shift + 0.3·k₀² imag perturbation:
    const shift = {
      re: 1.3 * k0sq * epsEff,
      im: 0.3 * k0sq,
    };
    const r = await solveMicrostripPml(FR4, {
      frequencyGHz: fGHz,
      geometry: {
        lateralPaddingFactor: 3,
        airPaddingFactor: 3,
        substrateMaxArea: 0.5, // mm² — substrate is ≈ 14 mm × 1.6 mm = 22 mm² → ~44 tri
        airMaxArea: 1.5, // mm²
      },
      pmlKappaMax: 3,
      shift,
      outerTol: 1e-3,
      outerMaxIter: 30,
      innerTol: 1e-4,
      innerMaxIter: 20000,
      wasmUrl: WASM_PATH,
    });

    // β² order-of-magnitude check. KJ-static says β² ≈ k₀² · ε_eff,
    // and on FR-4 ε_eff_KJ ≈ 3.3, so β² is in (k₀², 5 · k₀²).
    expect(Math.abs(r.beta2.re)).toBeGreaterThan(0.5 * r.k0Squared);
    expect(Math.abs(r.beta2.re)).toBeLessThan(8 * r.k0Squared);

    // ε_eff(f) recovery + Z₀ via Power-Current.
    const z = extractMicrostripZ0(r.mesh, r.topology, {
      eFreeEdges: r.eFreeEdges,
      eFreeNodes: r.eFreeNodes,
      edgePartition: r.edgePartition,
      nodePartition: r.nodePartition,
      beta2: r.beta2,
      k0Squared: r.k0Squared,
      frequencyGHz: fGHz,
      traceWidth: FR4.width,
      substrateHeight: FR4.height,
      conductorThickness: FR4.thickness,
    });
    console.log(
      `  FR-4 PML 20GHz: β² = (${r.beta2.re.toExponential(3)} + ` +
        `${r.beta2.im.toExponential(3)}j),  k₀²·ε_eff_KJ = ` +
        `${(r.k0Squared * r.epsEffSeed).toExponential(3)},  ` +
        `outer iter ${r.outerIterations}, inner iter ${r.innerIterations}, ` +
        `converged=${r.converged}\n` +
        `  ε_eff = ${z.epsilonEff.re.toFixed(3)} + ${z.epsilonEff.im.toExponential(2)}j,  ` +
        `|V| = ${z.voltageMagnitude.toExponential(3)},  ` +
        `Z₀(V-P) = ${z.z0.toFixed(2)} Ω,  ` +
        `KJ static Z₀ ≈ ${hammerstadJensen(FR4).z0.toFixed(2)} Ω`,
    );

    // ε_eff sanity: real part in [(εr+1)/2, εr] = [2.7, 4.4] for FR-4.
    expect(z.epsilonEff.re).toBeGreaterThan((FR4.epsilonR + 1) / 2);
    expect(z.epsilonEff.re).toBeLessThan(FR4.epsilonR);
    // Z₀ should be in a sensible range. KJ static for these params
    // is ≈ 49.8 Ω; full-wave at 20 GHz is similar order of magnitude.
    // The coarse-mesh + approximate I extraction makes ±50 % the
    // realistic tolerance here; tighter validation comes in
    // Stage 3a-vi-d with finer meshing and proper boundary-loop I.
    expect(z.z0).toBeGreaterThan(20);
    expect(z.z0).toBeLessThan(150);
  }, 120_000); // 120 s timeout — coarse mesh keeps Schur fast, but the inner solve is the long pole.
});
