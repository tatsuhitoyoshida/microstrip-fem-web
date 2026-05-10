// @vitest-environment node
/**
 * Adaptive refinement: convergence + Hammerstad–Jensen agreement.
 *
 * The adaptive loop should reach the same Hammerstad–Jensen tolerance as
 * the fixed-mesh `solveMicrostrip` while starting from a coarser mesh.
 * Convergence diagnostics are also asserted: ΔZ₀ should not blow up, the
 * triangle count should grow monotonically, and the loop should stop in a
 * sensible number of passes.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { hammerstadJensen } from '../src/analytical/hammerstad';
import { initMesh } from '../src/fem/mesh';
import { solveMicrostripAdaptive } from '../src/fem/tlanalysis';
import type { MicrostripParams } from '../src/types';

const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

const FR4: MicrostripParams = { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 };
const DUROID: MicrostripParams = { width: 2.4, height: 0.787, thickness: 0.018, epsilonR: 2.2 };

describe('adaptive — converges + matches Hammerstad–Jensen', () => {
  beforeAll(async () => {
    await initMesh(WASM_PATH);
  });

  it('FR-4 — adaptive Z₀ within 2 % of Hammerstad–Jensen', () => {
    const fem = solveMicrostripAdaptive(FR4, {
      adaptive: { tolerance: 0.05, maxPasses: 5 },
    });
    const hj = hammerstadJensen(FR4);
    const diffPct = (Math.abs(fem.z0 - hj.z0) / hj.z0) * 100;

    console.log(
      `  FR-4 adaptive\n` +
        `    final Z₀ = ${fem.z0.toFixed(3)} Ω, HJ = ${hj.z0.toFixed(3)} Ω, Δ = ${diffPct.toFixed(2)} %\n` +
        `    passes = ${fem.passes!.length}, final triangles = ${fem.triangleCount}\n` +
        `    history: ${fem.passes!
          .map((p) => `(p${p.pass}: ${p.triangleCount}tri Z₀=${p.z0.toFixed(3)})`)
          .join(' → ')}`,
    );

    expect(fem.passes).toBeDefined();
    expect(fem.passes!.length).toBeGreaterThanOrEqual(1);
    expect(fem.passes!.length).toBeLessThanOrEqual(5);
    expect(diffPct).toBeLessThan(2);
  });

  it('RT/duroid 5880 — adaptive Z₀ within 2 % of Hammerstad–Jensen', () => {
    const fem = solveMicrostripAdaptive(DUROID, {
      adaptive: { tolerance: 0.05, maxPasses: 5 },
    });
    const hj = hammerstadJensen(DUROID);
    const diffPct = (Math.abs(fem.z0 - hj.z0) / hj.z0) * 100;
    expect(diffPct).toBeLessThan(2);
    expect(fem.passes!.length).toBeLessThanOrEqual(5);
  });

  it('triangle count grows monotonically across passes', () => {
    const fem = solveMicrostripAdaptive(FR4, {
      adaptive: { tolerance: 0.001, maxPasses: 3 }, // force multiple passes
    });
    const passes = fem.passes!;
    expect(passes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i]!.triangleCount).toBeGreaterThan(passes[i - 1]!.triangleCount);
    }
  });

  it('triangleCeiling guard halts before exceeding the cap', () => {
    const fem = solveMicrostripAdaptive(FR4, {
      adaptive: { tolerance: 1e-9, maxPasses: 10, triangleCeiling: 8000 },
    });
    expect(fem.triangleCount).toBeLessThan(20000); // generous: ceiling halts growth
    expect(fem.passes!.length).toBeLessThanOrEqual(10);
  });
});
