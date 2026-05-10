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

import { dispersionCorrection } from '../analytical/dispersion';
import { hammerstadJensen } from '../analytical/hammerstad';
import {
  type MicrostripSolveOptions,
  type MicrostripSolveResult,
  solveMicrostrip,
  solveMicrostripAdaptive,
} from '../fem/tlanalysis';
import type { MicrostripParams } from '../types';

export interface BisectionOptions {
  /**
   * Absolute convergence tolerance |Z₀ − target| in Ω. Use this to pin
   * the stop criterion to a fixed Ω value regardless of target. If both
   * `tolerance` and `tolerancePct` are supplied, the **absolute** value
   * wins.
   */
  tolerance?: number;
  /**
   * Relative convergence tolerance, expressed as a fraction of the
   * target. Default 0.01 (= ±1 %, i.e. for target = 50 Ω the search
   * stops the moment a probe falls in [49.5, 50.5] Ω). This is what
   * the UI exposes — engineers think of impedance accuracy in percent.
   */
  tolerancePct?: number;
  /** Maximum bisection steps. Default 30. */
  maxIterations?: number;
  /** Forwarded to the FEM solver for every probe. */
  solveOptions?: MicrostripSolveOptions;
  /** Override the [low, high] bracket explicitly (mm). Skips HJ inversion. */
  bracket?: { low: number; high: number };
  /** Initial-bracket scaling around the HJ estimate. Default [0.5, 2.0]. */
  bracketFactor?: { low: number; high: number };
  /**
   * Operating frequency in GHz. When supplied (and > 0), the bisection
   * targets the **dispersion-corrected** Z₀(f) rather than the static
   * Z₀_qs from FEM. This matches what ResultsPanel displays as the
   * headline number, so a Find-W run with `target=50 Ω, frequency=10`
   * returns the W whose Z₀(10 GHz) ≈ 50 Ω, not the W whose Z₀_qs ≈ 50 Ω
   * (which at 10 GHz would render as Z₀ ≈ 48 Ω in the UI).
   *
   * Omitted or 0 → identity behaviour (static target), preserving the
   * pre-Round-7 numerics for the existing test suite.
   */
  frequencyGHz?: number;
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
  /**
   * Full FEM result of the last (recovered) probe. Reusing this avoids
   * one redundant solve at the recovered W; when bisection ran with the
   * same `solveOptions` as the caller wants for the report-quality solve,
   * this *is* the report-quality solve.
   */
  lastResult: MicrostripSolveResult;
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
  // Resolve the stop criterion: absolute Ω wins if explicitly set, else
  // derive from tolerancePct (default 1 %).
  const tolerance =
    options.tolerance ?? targetZ0 * (options.tolerancePct ?? 0.01);
  const maxIter = options.maxIterations ?? 30;
  const bracketFactor = options.bracketFactor ?? { low: 0.5, high: 2.0 };

  const hjW = inverseHammerstadJensen(targetZ0, fixed);
  let wLow = options.bracket?.low ?? bracketFactor.low * hjW;
  let wHigh = options.bracket?.high ?? bracketFactor.high * hjW;

  // Probe at the SAME quality level the caller will use to display the
  // result — otherwise the recovered W would be tuned to a Z₀(W) curve
  // (coarse-mesh) that doesn't match what gets shown (adaptive / dense).
  // The user's stated tolerance band would then be silently violated.
  // We don't forward an `onPass` callback so the worker's UI doesn't
  // get flooded with N×M progress events; bisection probes show up as
  // a single 'searching' stage.
  const useAdaptive = options.solveOptions?.adaptive !== undefined;
  const evaluate = (w: number): MicrostripSolveResult => {
    const params = { ...fixed, width: w };
    return useAdaptive
      ? solveMicrostripAdaptive(params, options.solveOptions)
      : solveMicrostrip(params, options.solveOptions);
  };

  // When the caller supplies an operating frequency, lift the FEM static
  // Z₀(W) curve through the Kirschning-Jansen dispersion correction so the
  // search lands on the W whose Z₀(f) — the value the user actually sees in
  // ResultsPanel — equals the target. f = 0 / undefined falls back to the
  // pre-Round-7 static-target behaviour (identity).
  const f = options.frequencyGHz ?? 0;
  const z0AtTarget = (r: MicrostripSolveResult, w: number): number => {
    if (f > 0) {
      const { z0Ratio } = dispersionCorrection({
        epsilonR: fixed.epsilonR,
        epsilonEffStatic: r.epsilonEff,
        widthMm: w,
        heightMm: fixed.height,
        frequencyGHz: f,
      });
      return r.z0 * z0Ratio;
    }
    return r.z0;
  };

  // Verify the bracket actually contains the root. Z₀ decreases with W, so
  // Z₀(low) > target > Z₀(high) is the expected ordering.
  const resAtLow = evaluate(wLow);
  const resAtHigh = evaluate(wHigh);
  const z0AtLow = z0AtTarget(resAtLow, wLow);
  const z0AtHigh = z0AtTarget(resAtHigh, wHigh);
  if (!(z0AtLow > targetZ0 && z0AtHigh < targetZ0)) {
    throw new Error(
      `findOptimalWidth: initial bracket [${wLow}, ${wHigh}] does not bracket Z₀=${targetZ0} ` +
        `(Z₀ at ends: ${z0AtLow.toFixed(3)} → ${z0AtHigh.toFixed(3)}). ` +
        'Widen `bracketFactor` or supply an explicit `bracket`.',
    );
  }

  let lastW = wLow;
  let lastResult: MicrostripSolveResult = resAtLow;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const wMid = 0.5 * (wLow + wHigh);
    const r = evaluate(wMid);
    const z0Eff = z0AtTarget(r, wMid);
    lastW = wMid;
    lastResult = r;
    if (Math.abs(z0Eff - targetZ0) < tolerance) {
      return {
        width: wMid,
        z0: r.z0,
        epsilonEff: r.epsilonEff,
        iterations: iter + 1,
        converged: true,
        hammerstadEstimate: hjW,
        lastResult: r,
      };
    }
    if (z0Eff > targetZ0) wLow = wMid;
    else wHigh = wMid;
  }

  return {
    width: lastW,
    z0: lastResult.z0,
    epsilonEff: lastResult.epsilonEff,
    iterations: iter,
    converged: false,
    hammerstadEstimate: hjW,
    lastResult,
  };
}
