/**
 * React hook that fronts the FEM Web Worker.
 *
 *   - `computeForward(params)` runs the full pipeline at the supplied
 *     geometry. The worker emits the FEM result plus the two closed-form
 *     comparison numbers.
 *   - `findOptimalW(targetZ0, fixed)` runs the bisection optimiser, then
 *     does one forward solve at the recovered W so the UI gets a complete
 *     result bundle.
 *
 * All heavy work happens off the main thread; the hook only translates
 * postMessage events into React state. Errors thrown inside the worker are
 * surfaced as `error` strings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicrostripSolveOptions, MicrostripSolveResult } from '../fem/tlanalysis';
import type { MicrostripParams, MicrostripResult } from '../types';
import type {
  AdaptivePassUpdate,
  ProgressStage,
  WorkerRequest,
  WorkerResponse,
} from '../workers/messages';
// Vite's `?worker` import bundles the worker as its own chunk.
import FemWorker from '../workers/femWorker.ts?worker';

export interface CalcResult {
  fem: MicrostripSolveResult;
  hammerstad: MicrostripResult;
  wheeler: MicrostripResult;
  optimalW?: number;
  /** ±-band that bisection targeted; only present after a Find-W run. */
  targetBand?: { targetZ0: number; pct: number; low: number; high: number };
  paramsUsed: MicrostripParams;
}

export interface UseMicrostripCalc {
  result: CalcResult | null;
  isLoading: boolean;
  /** Coarse status for the loading UI; `null` when idle. */
  progress: ProgressStage | null;
  /**
   * Pass-by-pass snapshots streamed from the worker during an adaptive run.
   * Reset to `[]` between requests, then appended once per pass. Used both
   * for the live heatmap and for letting the user scrub back through the
   * convergence history afterwards.
   */
  passPreviews: AdaptivePassUpdate[];
  error: string | null;
  computeForward: (params: MicrostripParams, options?: MicrostripSolveOptions) => Promise<void>;
  findOptimalW: (
    targetZ0: number,
    fixed: Omit<MicrostripParams, 'width'>,
    options?: MicrostripSolveOptions,
    /** Relative bisection tolerance (fraction). Default 0.01 = ±1 %. */
    tolerancePct?: number,
    /** Operating frequency in GHz. When > 0 the bisection targets the
     *  KJ-dispersion-corrected Z₀(f) instead of the static Z₀_qs from FEM. */
    frequencyGHz?: number,
  ) => Promise<number | null>;
}

interface PendingResolver {
  resolve: (msg: WorkerResponse) => void;
  reject: (err: Error) => void;
}

export function useMicrostripCalc(): UseMicrostripCalc {
  const [result, setResult] = useState<CalcResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressStage | null>(null);
  const [passPreviews, setPassPreviews] = useState<AdaptivePassUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, PendingResolver>>(new Map());
  const idRef = useRef(0);

  useEffect(() => {
    const worker = new FemWorker();
    const pending = pendingRef.current;
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress(msg.stage);
        if (msg.adaptive) {
          // Append the streamed pass snapshot. Cloning the array (instead of
          // mutating in place) ensures dependents like CrossSectionPlot
          // re-render with the new mesh.
          setPassPreviews((prev) => [...prev, msg.adaptive!]);
        }
        return;
      }
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.type === 'error') slot.reject(new Error(msg.message));
      else slot.resolve(msg);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  const dispatch = useCallback(<T extends WorkerResponse>(req: WorkerRequest): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('worker not initialised'));
    return new Promise<T>((resolve, reject) => {
      pendingRef.current.set(req.id, {
        resolve: resolve as (v: WorkerResponse) => void,
        reject,
      });
      worker.postMessage(req);
    });
  }, []);

  const computeForward = useCallback(
    async (params: MicrostripParams, options?: MicrostripSolveOptions): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setProgress('init');
      setPassPreviews([]);
      const id = ++idRef.current;
      try {
        const msg = await dispatch<WorkerResponse>({
          id,
          type: 'forward',
          params,
          ...(options !== undefined ? { options } : {}),
        });
        if (msg.type !== 'forward-result') return;
        setResult({
          fem: msg.fem,
          hammerstad: msg.hammerstad,
          wheeler: msg.wheeler,
          paramsUsed: msg.paramsUsed,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [dispatch],
  );

  const findOptimalW = useCallback(
    async (
      targetZ0: number,
      fixed: Omit<MicrostripParams, 'width'>,
      options?: MicrostripSolveOptions,
      tolerancePct?: number,
      frequencyGHz?: number,
    ): Promise<number | null> => {
      setIsLoading(true);
      setError(null);
      setProgress('init');
      setPassPreviews([]);
      const id = ++idRef.current;
      try {
        const msg = await dispatch<WorkerResponse>({
          id,
          type: 'findW',
          target: targetZ0,
          fixed,
          ...(options !== undefined ? { options } : {}),
          ...(tolerancePct !== undefined ? { tolerancePct } : {}),
          ...(frequencyGHz !== undefined ? { frequencyGHz } : {}),
        });
        if (msg.type !== 'findW-result') return null;
        setResult({
          fem: msg.fem,
          hammerstad: msg.hammerstad,
          wheeler: msg.wheeler,
          optimalW: msg.optimalW,
          targetBand: msg.targetBand,
          paramsUsed: msg.paramsUsed,
        });
        return msg.optimalW;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [dispatch],
  );

  return { result, isLoading, progress, passPreviews, error, computeForward, findOptimalW };
}
