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
import type { ProgressStage, WorkerRequest, WorkerResponse } from '../workers/messages';
// Vite's `?worker` import bundles the worker as its own chunk.
import FemWorker from '../workers/femWorker.ts?worker';

export interface CalcResult {
  fem: MicrostripSolveResult;
  hammerstad: MicrostripResult;
  wheeler: MicrostripResult;
  optimalW?: number;
  paramsUsed: MicrostripParams;
}

export interface UseMicrostripCalc {
  result: CalcResult | null;
  isLoading: boolean;
  /** Coarse status for the loading UI; `null` when idle. */
  progress: ProgressStage | null;
  error: string | null;
  computeForward: (params: MicrostripParams, options?: MicrostripSolveOptions) => Promise<void>;
  findOptimalW: (
    targetZ0: number,
    fixed: Omit<MicrostripParams, 'width'>,
    options?: MicrostripSolveOptions,
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
    ): Promise<number | null> => {
      setIsLoading(true);
      setError(null);
      setProgress('init');
      const id = ++idRef.current;
      try {
        const msg = await dispatch<WorkerResponse>({
          id,
          type: 'findW',
          target: targetZ0,
          fixed,
          ...(options !== undefined ? { options } : {}),
        });
        if (msg.type !== 'findW-result') return null;
        setResult({
          fem: msg.fem,
          hammerstad: msg.hammerstad,
          wheeler: msg.wheeler,
          optimalW: msg.optimalW,
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

  return { result, isLoading, progress, error, computeForward, findOptimalW };
}
