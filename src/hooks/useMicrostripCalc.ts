/**
 * React hook that drives the FEM + analytical pipeline from the UI.
 *
 * Two operations are exposed:
 *   - `computeForward(params)` runs `solveMicrostrip(params)` plus the two
 *     closed-form formulas, surfacing the joint result for the panels and
 *     the cross-section plot.
 *   - `findOptimalW(targetZ0, fixed)` runs the bisection optimiser, then
 *     does one extra forward solve at the recovered W so the UI gets a
 *     consistent result bundle.
 *
 * The work is dispatched via `queueMicrotask` so the React tree has a chance
 * to render the loading state before the FEM crunch begins. Phase 8 will
 * move the heavy work into a Web Worker; the public hook surface stays
 * Promise-based so that change is invisible to consumers.
 */

import { useCallback, useState } from 'react';
import { hammerstadJensen } from '../analytical/hammerstad';
import { wheeler } from '../analytical/wheeler';
import { initMesh } from '../fem/mesh';
import {
  solveMicrostrip,
  type MicrostripSolveOptions,
  type MicrostripSolveResult,
} from '../fem/tlanalysis';
import { findOptimalWidth } from '../optimization/bisection';
import type { MicrostripParams, MicrostripResult } from '../types';

export interface CalcResult {
  fem: MicrostripSolveResult;
  hammerstad: MicrostripResult;
  wheeler: MicrostripResult;
  /** Set only when the calculation was kicked off via `findOptimalW`. */
  optimalW?: number;
  /** Snapshot of the params used for this solve (for plot annotations). */
  paramsUsed: MicrostripParams;
}

export interface UseMicrostripCalc {
  result: CalcResult | null;
  isLoading: boolean;
  error: string | null;
  computeForward: (params: MicrostripParams, options?: MicrostripSolveOptions) => Promise<void>;
  findOptimalW: (
    targetZ0: number,
    fixed: Omit<MicrostripParams, 'width'>,
    options?: MicrostripSolveOptions,
  ) => Promise<number | null>;
}

export function useMicrostripCalc(): UseMicrostripCalc {
  const [result, setResult] = useState<CalcResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computeForward = useCallback(
    async (params: MicrostripParams, options?: MicrostripSolveOptions): Promise<void> => {
      setIsLoading(true);
      setError(null);
      // Yield to the renderer so the loading indicator paints first.
      await Promise.resolve();
      try {
        await initMesh();
        const fem = solveMicrostrip(params, options);
        const hj = hammerstadJensen(params);
        const wh = wheeler(params);
        setResult({ fem, hammerstad: hj, wheeler: wh, paramsUsed: params });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const findOptimalW = useCallback(
    async (
      targetZ0: number,
      fixed: Omit<MicrostripParams, 'width'>,
      options?: MicrostripSolveOptions,
    ): Promise<number | null> => {
      setIsLoading(true);
      setError(null);
      await Promise.resolve();
      try {
        await initMesh();
        const opt = findOptimalWidth(targetZ0, fixed, options ? { solveOptions: options } : {});
        const params: MicrostripParams = { ...fixed, width: opt.width };
        const fem = solveMicrostrip(params, options);
        const hj = hammerstadJensen(params);
        const wh = wheeler(params);
        setResult({
          fem,
          hammerstad: hj,
          wheeler: wh,
          optimalW: opt.width,
          paramsUsed: params,
        });
        return opt.width;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { result, isLoading, error, computeForward, findOptimalW };
}
