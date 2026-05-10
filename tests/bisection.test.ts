// @vitest-environment node
/**
 * Phase 5 completion test: bisection-based width search.
 *
 * Spec (CLAUDE.md §6 Phase 5): "50 Ω 目標で W が 0.05 Ω 精度で求まる" — i.e.
 * for a 50 Ω target, the FEM Z₀ at the recovered W must be within 0.05 Ω of
 * 50. The bisection driver itself is mesh-independent, so this test runs at
 * the default (~5 k triangle) mesh density to keep wall time reasonable —
 * each FEM probe is ~50–150 ms.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { dispersionCorrection } from '../src/analytical/dispersion';
import { initMesh } from '../src/fem/mesh';
import { solveMicrostrip } from '../src/fem/tlanalysis';
import { findOptimalWidth, inverseHammerstadJensen } from '../src/optimization/bisection';
import { hammerstadJensen } from '../src/analytical/hammerstad';

const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

describe('inverseHammerstadJensen', () => {
  it('round-trips: HJ(inverse(target)) == target', () => {
    const fixed = { height: 1.6, thickness: 0.035, epsilonR: 4.4 };
    for (const target of [25, 50, 75, 100]) {
      const w = inverseHammerstadJensen(target, fixed);
      const z = hammerstadJensen({ ...fixed, width: w }).z0;
      expect(Math.abs(z - target)).toBeLessThan(1e-6);
    }
  });
});

// Bisection takes 8–9 FEM probes; the production-default mesh (~25 k tri)
// would push each probe past 250 ms. The bisection algorithm itself is
// mesh-independent, so the tests run with a deliberately coarser grid for
// speed. The convergence criterion (|Z₀ − 50| < 0.05 Ω) is checked against
// whatever Z₀ that mesh produces, not against Hammerstad–Jensen.
const COARSE_SOLVE_OPTIONS = {
  geometry: {
    substrateMaxArea: 0.05,
    airMaxArea: 0.5,
  },
};

describe('Phase 5 — findOptimalWidth via FEM bisection', () => {
  beforeAll(async () => {
    await initMesh(WASM_PATH);
  });

  it('FR-4 50 Ω target → recovers W with |Z₀ − 50| < 0.05 Ω', () => {
    // Phase 5 spec is an explicit absolute Ω tolerance; pass it directly so
    // the test isn't coupled to the default tolerancePct (now 1 %).
    const result = findOptimalWidth(
      50,
      { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
      { solveOptions: COARSE_SOLVE_OPTIONS, tolerance: 0.05 },
    );

    console.log(
      `  FR-4 50 Ω: W = ${result.width.toFixed(4)} mm (HJ estimate ${result.hammerstadEstimate.toFixed(4)} mm), ` +
        `Z₀ = ${result.z0.toFixed(4)} Ω, ε_eff = ${result.epsilonEff.toFixed(3)}, ` +
        `iters = ${result.iterations}, converged = ${result.converged}`,
    );

    expect(result.converged).toBe(true);
    expect(Math.abs(result.z0 - 50)).toBeLessThan(0.05);
    // HJ predicts ~3 mm; FEM-recovered W should be in the same ballpark.
    expect(result.width).toBeGreaterThan(2);
    expect(result.width).toBeLessThan(4);
  });

  it('RT/duroid 50 Ω target → recovers W within 0.05 Ω', () => {
    const result = findOptimalWidth(
      50,
      { height: 0.787, thickness: 0.018, epsilonR: 2.2 },
      { solveOptions: COARSE_SOLVE_OPTIONS, tolerance: 0.05 },
    );

    console.log(
      `  RT/duroid 50 Ω: W = ${result.width.toFixed(4)} mm (HJ ${result.hammerstadEstimate.toFixed(4)} mm), ` +
        `Z₀ = ${result.z0.toFixed(4)} Ω, iters = ${result.iterations}`,
    );

    expect(result.converged).toBe(true);
    expect(Math.abs(result.z0 - 50)).toBeLessThan(0.05);
  });

  it('handles a non-50 target (75 Ω) on FR-4', () => {
    const result = findOptimalWidth(
      75,
      { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
      { solveOptions: COARSE_SOLVE_OPTIONS, tolerance: 0.05 },
    );
    expect(result.converged).toBe(true);
    expect(Math.abs(result.z0 - 75)).toBeLessThan(0.05);
  });

  it('relative tolerance: tolerancePct=0.01 stops within 1 % of the target', () => {
    const result = findOptimalWidth(
      50,
      { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
      { solveOptions: COARSE_SOLVE_OPTIONS, tolerancePct: 0.01 },
    );
    expect(result.converged).toBe(true);
    // ±1 % of 50 Ω = ±0.5 Ω
    expect(Math.abs(result.z0 - 50)).toBeLessThan(0.5);
  });

  it('absolute tolerance still wins when both are set', () => {
    // tolerance=0.01 Ω is tighter than tolerancePct=0.10 (5 Ω). The absolute
    // value should drive the stop criterion.
    const result = findOptimalWidth(
      50,
      { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
      { solveOptions: COARSE_SOLVE_OPTIONS, tolerance: 0.01, tolerancePct: 0.1 },
    );
    expect(result.converged).toBe(true);
    expect(Math.abs(result.z0 - 50)).toBeLessThan(0.01);
  });

  it('rejects an explicit bracket that fails to contain the root', () => {
    // 50 Ω with a [0.05, 0.1]-mm bracket cannot contain the FR-4 root (~3 mm).
    expect(() =>
      findOptimalWidth(
        50,
        { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
        { bracket: { low: 0.05, high: 0.1 } },
      ),
    ).toThrow(/bracket/);
  });

  it('Round 7: f-aware bisection — FR-4 50 Ω at 10 GHz lands narrower than the static result', () => {
    // Static target: W ≈ 3 mm gives Z₀_qs ≈ 50 Ω on FR-4.
    // At 10 GHz the KJ correction drops Z₀(10) to ~48 Ω at the same W,
    // so to hit Z₀(10) = 50 we need W < 3 mm. Verify the f-aware bisection
    // returns a width matching that physical expectation.
    const fixed = { height: 1.6, thickness: 0.035, epsilonR: 4.4 };

    const staticResult = findOptimalWidth(50, fixed, {
      solveOptions: COARSE_SOLVE_OPTIONS,
      tolerance: 0.05,
    });

    const fAwareResult = findOptimalWidth(50, fixed, {
      solveOptions: COARSE_SOLVE_OPTIONS,
      tolerance: 0.05,
      frequencyGHz: 10,
    });

    console.log(
      `  Static W = ${staticResult.width.toFixed(4)} mm, ` +
        `f-aware (10 GHz) W = ${fAwareResult.width.toFixed(4)} mm`,
    );

    expect(fAwareResult.converged).toBe(true);
    // f-aware W should sit strictly below the static-target W (because at
    // 10 GHz Z₀(f) < Z₀_qs, so to push Z₀(f) up to 50 we must narrow W).
    expect(fAwareResult.width).toBeLessThan(staticResult.width);
    // And the displayed (KJ-corrected) Z₀ at the recovered W should hit
    // the 50 Ω target within tolerance.
    const probe = solveMicrostrip(
      { ...fixed, width: fAwareResult.width },
      COARSE_SOLVE_OPTIONS,
    );
    const { z0Ratio } = dispersionCorrection({
      epsilonR: fixed.epsilonR,
      epsilonEffStatic: probe.epsilonEff,
      widthMm: fAwareResult.width,
      heightMm: fixed.height,
      frequencyGHz: 10,
    });
    const z0F = probe.z0 * z0Ratio;
    expect(Math.abs(z0F - 50)).toBeLessThan(0.1);
  });
});
