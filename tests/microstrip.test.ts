// @vitest-environment node
/**
 * Phase 4 completion test: full microstrip Z₀ / ε_eff extraction via
 * end-to-end FEM, cross-checked against the Hammerstad–Jensen closed-form.
 *
 * Phase 4 spec (CLAUDE.md §6) — "標準的な microstrip 形状で Hammerstad 式と
 * 2 % 以内、HFSS 結果と 1 % 以内で Z₀ が一致". The HFSS data lives outside the
 * automated suite; here we verify the analytical-formula agreement.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { initMesh } from '../src/fem/mesh';
import { characteristicImpedance, solveMicrostrip } from '../src/fem/tlanalysis';
import { hammerstadJensen } from '../src/analytical/hammerstad';
import type { MicrostripParams } from '../src/types';

const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

interface RefCase {
  label: string;
  params: MicrostripParams;
}

const REFERENCES: RefCase[] = [
  {
    label: 'FR-4 (εr=4.4, h=1.6mm, t=0.035mm, W=3.0mm)',
    params: { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 },
  },
  {
    label: 'RT/duroid 5880 (εr=2.2, h=0.787mm, t=0.018mm, W=2.40mm)',
    params: { width: 2.4, height: 0.787, thickness: 0.018, epsilonR: 2.2 },
  },
  {
    label: 'Alumina (εr=9.8, h=0.635mm, t=0.005mm, W=0.59mm)',
    params: { width: 0.59, height: 0.635, thickness: 0.005, epsilonR: 9.8 },
  },
];

const TOLERANCE_PCT = 2;

describe('Phase 4 — FEM Z₀ vs Hammerstad–Jensen (within 2 %)', () => {
  beforeAll(async () => {
    await initMesh(WASM_PATH);
  });

  for (const { label, params } of REFERENCES) {
    it(`${label}`, () => {
      // Tighten the default geometry / mesh: a wider truncation box and
      // smaller per-region triangles bring FEM accuracy below the 2 %
      // tolerance the spec demands.
      const fem = solveMicrostrip(params, {
        geometry: {
          lateralPaddingFactor: 20,
          airPaddingFactor: 15,
          substrateMaxArea: ((20 * params.height + params.width) * params.height) / 6000,
          airMaxArea:
            ((20 * params.height + params.width) * (15 * params.height) -
              params.width * params.thickness) /
            10000,
        },
      });
      const hj = hammerstadJensen(params);

      const z0Diff = (Math.abs(fem.z0 - hj.z0) / hj.z0) * 100;
      const eEffDiff = (Math.abs(fem.epsilonEff - hj.epsilonEff) / hj.epsilonEff) * 100;

      // Surface diagnostics so a regression makes the cause obvious.
      console.log(
        `  ${label}\n` +
          `    FEM:           Z₀ = ${fem.z0.toFixed(3)} Ω,  ε_eff = ${fem.epsilonEff.toFixed(3)}\n` +
          `    Hammerstad-J:  Z₀ = ${hj.z0.toFixed(3)} Ω,  ε_eff = ${hj.epsilonEff.toFixed(3)}\n` +
          `    Δ Z₀ = ${z0Diff.toFixed(2)} %, Δ ε_eff = ${eEffDiff.toFixed(2)} %\n` +
          `    triangles=${fem.triangleCount}, CG iters dielectric=${fem.cgIterations.withDielectric}, vacuum=${fem.cgIterations.vacuum}`,
      );

      expect(z0Diff).toBeLessThan(TOLERANCE_PCT);
      expect(eEffDiff).toBeLessThan(TOLERANCE_PCT);
      // ε_eff must always sit between (εr+1)/2 and εr.
      expect(fem.epsilonEff).toBeGreaterThan((params.epsilonR + 1) / 2);
      expect(fem.epsilonEff).toBeLessThan(params.epsilonR);
    });
  }

  it('characteristicImpedance scales correctly: 2× C and C₀ → Z₀ halves', () => {
    // Closed-form sanity check on tlanalysis helpers (no FEM involved).
    const z1 = characteristicImpedance(1e-10, 1e-10);
    const z2 = characteristicImpedance(2e-10, 2e-10);
    expect(z2 / z1).toBeCloseTo(0.5, 6);
  });
});
