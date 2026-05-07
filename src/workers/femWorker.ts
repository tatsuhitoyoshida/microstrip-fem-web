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
import { solveMicrostrip } from '../fem/tlanalysis';
import { findOptimalWidth } from '../optimization/bisection';
import type { ProgressStage, WorkerRequest, WorkerResponse } from './messages';

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = initMesh('/triangle.out.wasm');
  return initPromise;
}

function post(message: WorkerResponse): void {
  // The DedicatedWorkerGlobalScope.postMessage signature in lib.dom is fine
  // with arbitrary serialisable payloads.
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

function progress(id: number, stage: ProgressStage): void {
  post({ id, type: 'progress', stage });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = event.data;
  const { id } = msg;
  try {
    progress(id, 'init');
    await ensureInit();

    if (msg.type === 'forward') {
      progress(id, 'meshing-and-solving');
      const fem = solveMicrostrip(msg.params, msg.options);
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
      const opt = findOptimalWidth(
        msg.target,
        msg.fixed,
        msg.options ? { solveOptions: msg.options } : {},
      );
      const params = { ...msg.fixed, width: opt.width };
      progress(id, 'meshing-and-solving');
      const fem = solveMicrostrip(params, msg.options);
      const hj = hammerstadJensen(params);
      const wh = wheeler(params);
      post({
        id,
        type: 'findW-result',
        fem,
        hammerstad: hj,
        wheeler: wh,
        paramsUsed: params,
        optimalW: opt.width,
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
