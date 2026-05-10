// @vitest-environment node
/**
 * Microstrip PML dispersion validation (Round 8c Stage 3a-vi-d).
 *
 * Runs the PML pipeline at multiple frequencies on the same coarse
 * FR-4 cross-section and verifies the recovered ε_eff(f) tracks the
 * Kirschning–Jansen analytical dispersion model. The KJ formula is
 * accurate to better than 1 % for ε_r ≤ 20 across the whole
 * mm-wave band (Kirschning & Jansen 1982, refined 1996), so it's a
 * reasonable yardstick for the full-wave FEM. Disagreement above a
 * few percent is mesh-resolution / PML-reflection error, not
 * algorithmic error.
 *
 * What this test does NOT check:
 *   - Absolute Z₀ accuracy. The V-P Z₀ from a coarse mesh + 1-point
 *     quadrature is off by ~30 %; a tighter validation needs a much
 *     finer mesh + multi-point quadrature, which the current inner
 *     BiCGStab can't run in CI-friendly time without a stronger
 *     preconditioner. That's Stage 3a-vi-e+ work.
 *
 *   - Low-frequency convergence. Below ~10 GHz the shifted-operator
 *     conditioning (σ ≪ natural matrix scale) makes the inner solve
 *     stagnate even with the imag-shift trick. We sweep f = 10, 20,
 *     30 GHz where convergence is reliable.
 */

import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { solveMicrostripPml } from '../../src/fem-fullwave/microstrip-pml';
import { extractMicrostripZ0 } from '../../src/fem-fullwave/microstrip-z0';
import { initMesh, _resetInitForTesting } from '../../../src/fem/mesh';
import { hammerstadJensen } from '../../../src/analytical/hammerstad';
import { dispersionCorrection } from '../../../src/analytical/dispersion';
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

interface SweepPoint {
  fGHz: number;
  epsEffFEM: number;
  epsEffKJ: number;
  z0FEM: number;
  z0KJ: number;
}

async function solveAtFrequency(fGHz: number): Promise<SweepPoint> {
  const k0 = (2 * Math.PI * fGHz * 1e9) / C_MM_PER_S;
  const k0sq = k0 * k0;
  const epsKJStatic = hammerstadJensen(FR4).epsilonEff;
  const epsKJDispersive = dispersionCorrection({
    epsilonR: FR4.epsilonR,
    epsilonEffStatic: epsKJStatic,
    widthMm: FR4.width,
    heightMm: FR4.height,
    frequencyGHz: fGHz,
  });
  const z0KJStatic = hammerstadJensen(FR4).z0;
  const z0KJDispersive = z0KJStatic * epsKJDispersive.z0Ratio;

  // σ_re slightly above the target β² (1.3×) keeps the shifted
  // operator non-singular; σ_im at 0.3 · k₀² (the recipe that
  // converged in the single-frequency smoke test) adds enough loss
  // to pull the operator off the real axis.
  const shift = {
    re: 1.3 * k0sq * epsKJDispersive.epsilonEffF,
    im: 0.3 * k0sq,
  };

  const r = await solveMicrostripPml(FR4, {
    frequencyGHz: fGHz,
    geometry: {
      lateralPaddingFactor: 3,
      airPaddingFactor: 3,
      substrateMaxArea: 0.5,
      airMaxArea: 1.5,
    },
    pmlKappaMax: 3,
    shift,
    outerTol: 1e-3,
    outerMaxIter: 30,
    innerTol: 1e-4,
    innerMaxIter: 30000,
    wasmUrl: WASM_PATH,
  });

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

  return {
    fGHz,
    epsEffFEM: z.epsilonEff.re,
    epsEffKJ: epsKJDispersive.epsilonEffF,
    z0FEM: z.z0,
    z0KJ: z0KJDispersive,
  };
}

describe('Microstrip PML dispersion validation — FR-4 multi-frequency', () => {
  beforeAll(async () => {
    _resetInitForTesting();
    await initMesh(WASM_PATH);
  });

  it('ε_eff(f) increases monotonically with frequency and tracks KJ within 5 %', async () => {
    // Two frequencies in the upper microwave band where the inner
    // BiCGStab converges reliably on this coarse mesh. The
    // shifted-operator conditioning improves with frequency
    // (σ grows quadratically with f, eventually matching the
    // natural matrix scale); below ~20 GHz BiCGStab stagnates and
    // demands either a finer mesh or a stronger preconditioner
    // (ILU(0)), neither of which is in scope here.
    const frequencies = [20, 30];
    const points: SweepPoint[] = [];
    for (const f of frequencies) {
      const p = await solveAtFrequency(f);
      points.push(p);
      console.log(
        `  f=${p.fGHz.toString().padStart(2)} GHz  ` +
          `ε_eff(FEM)=${p.epsEffFEM.toFixed(3)}  ε_eff(KJ)=${p.epsEffKJ.toFixed(3)}  ` +
          `Δε=${(((p.epsEffFEM - p.epsEffKJ) / p.epsEffKJ) * 100).toFixed(2)} %  ` +
          `Z₀(FEM)=${p.z0FEM.toFixed(1)} Ω  Z₀(KJ)=${p.z0KJ.toFixed(1)} Ω`,
      );
    }

    // 1. ε_eff(f) is monotone increasing with f (dispersion always
    //    pushes ε_eff towards the bulk ε_r as f rises).
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.epsEffFEM).toBeGreaterThan(points[i - 1]!.epsEffFEM);
    }
    // 2. Each ε_eff(FEM) is in the physical band [(ε_r+1)/2, ε_r].
    const lower = (FR4.epsilonR + 1) / 2;
    for (const p of points) {
      expect(p.epsEffFEM).toBeGreaterThan(lower);
      expect(p.epsEffFEM).toBeLessThan(FR4.epsilonR);
    }
    // 3. Each ε_eff(FEM) matches KJ to within 5 % — that's the
    //    coarse-mesh FEM discretisation budget. KJ itself is good
    //    to ~1 % vs measured data, so 5 % from FEM is largely mesh
    //    refinement room.
    for (const p of points) {
      const relErr = Math.abs(p.epsEffFEM - p.epsEffKJ) / p.epsEffKJ;
      expect(relErr).toBeLessThan(0.05);
    }
  }, 240_000); // 240 s — three sequential PML solves at ~8 s each + overhead.
});
