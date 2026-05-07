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
import { initMesh } from '../src/fem/mesh';
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
    const result = findOptimalWidth(
      50,
      { height: 1.6, thickness: 0.035, epsilonR: 4.4 },
      { solveOptions: COARSE_SOLVE_OPTIONS },
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
      { solveOptions: COARSE_SOLVE_OPTIONS },
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
      { solveOptions: COARSE_SOLVE_OPTIONS },
    );
    expect(result.converged).toBe(true);
    expect(Math.abs(result.z0 - 75)).toBeLessThan(0.05);
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
});
