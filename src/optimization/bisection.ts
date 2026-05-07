/**
 * Bisection-based width search: find the trace width W such that the FEM
 * Z₀(W) hits a target value (typically 50 Ω).
 *
 * Strategy (per CLAUDE.md §6 Phase 5):
 *   1. Use the closed-form Hammerstad–Jensen formula (microsecond-cheap) to
 *      get a W₀ estimate.
 *   2. Bracket the FEM root in [0.5·W₀, 2·W₀]. Z₀(W) is monotonically
 *      decreasing for fixed h, εr, t, so the bracket is reliable.
 *   3. Bisect the FEM Z₀(W) until |Z₀ − target| < tolerance.
 *
 * Each FEM evaluation is non-trivial (mesh + two solves), so the optimiser
 * caches nothing across calls and the caller is expected to use a coarser
 * mesh for the search than for a final report-quality run.
 */

import { hammerstadJensen } from '../analytical/hammerstad';
import { solveMicrostrip, type MicrostripSolveOptions } from '../fem/tlanalysis';
import type { MicrostripParams } from '../types';

export interface BisectionOptions {
  /** Convergence tolerance |Z₀ − target| in Ω. Default 0.05 (CLAUDE.md spec). */
  tolerance?: number;
  /** Maximum bisection steps. Default 30. */
  maxIterations?: number;
  /** Forwarded to the FEM solver for every probe. */
  solveOptions?: MicrostripSolveOptions;
  /** Override the [low, high] bracket explicitly (mm). Skips HJ inversion. */
  bracket?: { low: number; high: number };
  /** Initial-bracket scaling around the HJ estimate. Default [0.5, 2.0]. */
  bracketFactor?: { low: number; high: number };
}

export interface OptimalWidthResult {
  /** Recovered trace width [same length unit as `params.height`]. */
  width: number;
  /** FEM Z₀ at the recovered width [Ω]. */
  z0: number;
  /** ε_eff at the recovered width. */
  epsilonEff: number;
  /** Number of FEM bisection probes. */
  iterations: number;
  converged: boolean;
  /** Initial Hammerstad–Jensen estimate that seeded the bracket [mm]. */
  hammerstadEstimate: number;
}

/**
 * Invert Hammerstad–Jensen for W given a target Z₀ via a tight inner
 * bisection. HJ is monotonic in W, so this is unconditionally stable.
 */
export function inverseHammerstadJensen(
  targetZ0: number,
  fixed: Omit<MicrostripParams, 'width'>,
): number {
  let low = 1e-3 * fixed.height;
  let high = 1e3 * fixed.height;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (low + high);
    const z = hammerstadJensen({ ...fixed, width: mid }).z0;
    if (z > targetZ0) low = mid;
    else high = mid;
    if (high - low < 1e-9 * fixed.height) break;
  }
  return 0.5 * (low + high);
}

/**
 * Search for the trace width that makes FEM Z₀(W) equal `targetZ0` within
 * `tolerance`.
 */
export function findOptimalWidth(
  targetZ0: number,
  fixed: Omit<MicrostripParams, 'width'>,
  options: BisectionOptions = {},
): OptimalWidthResult {
  const tolerance = options.tolerance ?? 0.05;
  const maxIter = options.maxIterations ?? 30;
  const bracketFactor = options.bracketFactor ?? { low: 0.5, high: 2.0 };

  const hjW = inverseHammerstadJensen(targetZ0, fixed);
  let wLow = options.bracket?.low ?? bracketFactor.low * hjW;
  let wHigh = options.bracket?.high ?? bracketFactor.high * hjW;

  const evaluate = (w: number): { z0: number; epsilonEff: number } => {
    const r = solveMicrostrip({ ...fixed, width: w }, options.solveOptions);
    return { z0: r.z0, epsilonEff: r.epsilonEff };
  };

  // Verify the bracket actually contains the root. Z₀ decreases with W, so
  // Z₀(low) > target > Z₀(high) is the expected ordering.
  const zAtLow = evaluate(wLow).z0;
  const zAtHigh = evaluate(wHigh).z0;
  if (!(zAtLow > targetZ0 && zAtHigh < targetZ0)) {
    throw new Error(
      `findOptimalWidth: initial bracket [${wLow}, ${wHigh}] does not bracket Z₀=${targetZ0} ` +
        `(Z₀ at ends: ${zAtLow.toFixed(3)} → ${zAtHigh.toFixed(3)}). ` +
        'Widen `bracketFactor` or supply an explicit `bracket`.',
    );
  }

  let lastW = wLow;
  let lastZ = zAtLow;
  let lastEEff = 0;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const wMid = 0.5 * (wLow + wHigh);
    const { z0, epsilonEff } = evaluate(wMid);
    lastW = wMid;
    lastZ = z0;
    lastEEff = epsilonEff;
    if (Math.abs(z0 - targetZ0) < tolerance) {
      return {
        width: wMid,
        z0,
        epsilonEff,
        iterations: iter + 1,
        converged: true,
        hammerstadEstimate: hjW,
      };
    }
    if (z0 > targetZ0) wLow = wMid;
    else wHigh = wMid;
  }

  return {
    width: lastW,
    z0: lastZ,
    epsilonEff: lastEEff,
    iterations: iter,
    converged: false,
    hammerstadEstimate: hjW,
  };
}
