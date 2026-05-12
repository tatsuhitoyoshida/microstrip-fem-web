/// <reference lib="WebWorker" />
/**
 * FEM Web Worker entrypoint. Owns the triangle-wasm runtime, handles
 * forward / find-W requests, and reports back progress + result messages.
 *
 * Keeping the FEM crunch off the main thread lets the React tree continue
 * to repaint during the multi-hundred-millisecond mesh + solve, which
 * makes the loading state feel responsive (CLAUDE.md §6 Phase 8 spec).
 */

import { hammerstadJensen } from '../analytical/hammerstad';
import { wheeler } from '../analytical/wheeler';
import { initMesh } from '../fem/mesh';
import {
  type AdaptivePassInfo,
  type MicrostripSolveOptions,
  type MicrostripSolveResult,
  solveMicrostrip,
  solveMicrostripAdaptive,
} from '../fem/tlanalysis';
import { findOptimalWidth } from '../optimization/bisection';
import type {
  AdaptivePassUpdate,
  ProgressStage,
  WorkerRequest,
  WorkerResponse,
} from './messages';
import type { MicrostripParams } from '../types';

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  // `import.meta.env.BASE_URL` resolves to whatever Vite's `base` is set to
  // (e.g. `/microstrip-fem-web/` on GitHub Pages, `/` on a custom domain),
  // so the WASM asset is fetched from the same prefix the page itself is
  // served from. The trailing slash is guaranteed by Vite.
  if (!initPromise) initPromise = initMesh(`${import.meta.env.BASE_URL}triangle.out.wasm`);
  return initPromise;
}

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  // The DedicatedWorkerGlobalScope.postMessage signature in lib.dom is fine
  // with arbitrary serialisable payloads.
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer ?? []);
}

function progress(id: number, stage: ProgressStage): void {
  post({ id, type: 'progress', stage });
}

/**
 * Dispatch to the adaptive or fixed-mesh solver based on `options.adaptive`.
 * Adaptive progress is streamed back via the `adaptive-pass` stage so the
 * UI can show pass-by-pass convergence; per-pass mesh + φ are copied and
 * **transferred** so the main thread receives ownership without a structured
 * clone (~600 kB / pass on the FR-4 reference).
 */
function runSolve(
  id: number,
  params: MicrostripParams,
  options: MicrostripSolveOptions | undefined,
): MicrostripSolveResult {
  if (options?.adaptive) {
    return solveMicrostripAdaptive(
      params,
      options,
      (info: AdaptivePassInfo, passResult: MicrostripSolveResult) => {
        // Copy the mesh + φ buffers — the inner solveMicrostripAdaptive loop
        // still needs the originals to compute the next pass's error
        // indicator. Transferring the copies is free (no structured clone).
        const verticesCopy = new Float64Array(passResult.mesh.vertices);
        const trianglesCopy = new Int32Array(passResult.mesh.triangles);
        const phiCopy = new Float64Array(passResult.phi);
        const adaptive: AdaptivePassUpdate = {
          pass: info.pass,
          triangleCount: info.triangleCount,
          z0: info.z0,
          epsilonEff: info.epsilonEff,
          deltaZ0: info.deltaZ0,
          vertices: verticesCopy,
          triangles: trianglesCopy,
          phi: phiCopy,
          bounds: { ...passResult.bounds },
        };
        post(
          { id, type: 'progress', stage: 'adaptive-pass', adaptive },
          [verticesCopy.buffer, trianglesCopy.buffer, phiCopy.buffer],
        );
      },
    );
  }
  return solveMicrostrip(params, options);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = event.data;
  const { id } = msg;
  try {
    progress(id, 'init');
    await ensureInit();

    if (msg.type === 'forward') {
      progress(id, 'meshing-and-solving');
      const fem = runSolve(id, msg.params, msg.options);
      const hj = hammerstadJensen(msg.params);
      const wh = wheeler(msg.params);
      post({
        id,
        type: 'forward-result',
        fem,
        hammerstad: hj,
        wheeler: wh,
        paramsUsed: msg.params,
      });
      return;
    }

    if (msg.type === 'findW') {
      progress(id, 'searching');
      // Probe at the same quality the user wants for the displayed
      // result. Otherwise a coarse-mesh bisection lands on a W whose
      // adaptive / dense-mesh Z₀ silently drifts outside the tolerance
      // band the user just specified. `findOptimalWidth` returns the
      // last probe's full MicrostripSolveResult, so we hand it straight
      // to the UI — no redundant final solve.
      const tolerancePct = msg.tolerancePct ?? 0.01;
      const searchOptions = {
        ...(msg.options !== undefined ? { solveOptions: msg.options } : {}),
        ...(msg.frequencyGHz !== undefined ? { frequencyGHz: msg.frequencyGHz } : {}),
        tolerancePct,
      };
      const opt = findOptimalWidth(msg.target, msg.fixed, searchOptions);
      const params = { ...msg.fixed, width: opt.width };
      const fem = opt.lastResult;
      const hj = hammerstadJensen(params);
      const wh = wheeler(params);
      const halfBand = msg.target * tolerancePct;
      post({
        id,
        type: 'findW-result',
        fem,
        hammerstad: hj,
        wheeler: wh,
        paramsUsed: params,
        optimalW: opt.width,
        targetBand: {
          targetZ0: msg.target,
          pct: tolerancePct,
          low: msg.target - halfBand,
          high: msg.target + halfBand,
        },
      });
      return;
    }
  } catch (err) {
    post({
      id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
