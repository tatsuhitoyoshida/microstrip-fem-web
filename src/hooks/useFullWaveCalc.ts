/**
 * React hook fronting the full-wave PML eigensolver in the FEM worker.
 *
 * This is the "experimental" path — distinct from `useMicrostripCalc`
 * (which owns the quasi-static + KJ post-process pipeline that ships
 * in the main UI). The full-wave hook is consumed by the dedicated
 * Full-wave page; see `docs/roadmap.md` for the convergence /
 * preconditioner gating that keeps it off the main calculator.
 *
 * Each invocation spawns its own short-lived worker so the main UI's
 * persistent worker isn't tied up by a multi-second eigenvalue solve.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicrostripParams } from '../types';
import type {
  FullWaveResultMessage,
  WorkerRequest,
  WorkerResponse,
} from '../workers/messages';
import FemWorker from '../workers/femWorker.ts?worker';

export interface FullWaveResult {
  paramsUsed: MicrostripParams;
  frequencyGHz: number;
  beta2: { re: number; im: number };
  epsilonEff: { re: number; im: number };
  z0: number;
  kjReferenceEpsEff: number;
  kjReferenceZ0: number;
  outerIterations: number;
  innerIterations: number;
  converged: boolean;
  elapsedMs: number;
}

export interface UseFullWaveCalc {
  result: FullWaveResult | null;
  isLoading: boolean;
  error: string | null;
  compute: (params: MicrostripParams, frequencyGHz: number) => Promise<void>;
}

interface PendingResolver {
  resolve: (msg: WorkerResponse) => void;
  reject: (err: Error) => void;
}

export function useFullWaveCalc(): UseFullWaveCalc {
  const [result, setResult] = useState<FullWaveResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
      if (msg.type === 'progress') return;
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

  const dispatch = useCallback(
    <T extends WorkerResponse>(req: WorkerRequest): Promise<T> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error('worker not initialised'));
      return new Promise<T>((resolve, reject) => {
        pendingRef.current.set(req.id, {
          resolve: resolve as (v: WorkerResponse) => void,
          reject,
        });
        worker.postMessage(req);
      });
    },
    [],
  );

  const compute = useCallback(
    async (params: MicrostripParams, frequencyGHz: number): Promise<void> => {
      setIsLoading(true);
      setError(null);
      const id = ++idRef.current;
      try {
        const msg = await dispatch<WorkerResponse>({
          id,
          type: 'fullwave',
          params,
          frequencyGHz,
        });
        if (msg.type !== 'fullwave-result') return;
        const r = msg as FullWaveResultMessage;
        setResult({
          paramsUsed: r.paramsUsed,
          frequencyGHz: r.frequencyGHz,
          beta2: r.beta2,
          epsilonEff: r.epsilonEff,
          z0: r.z0,
          kjReferenceEpsEff: r.kjReferenceEpsEff,
          kjReferenceZ0: r.kjReferenceZ0,
          outerIterations: r.outerIterations,
          innerIterations: r.innerIterations,
          converged: r.converged,
          elapsedMs: r.elapsedMs,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [dispatch],
  );

  return { result, isLoading, error, compute };
}
