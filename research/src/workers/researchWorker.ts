/// <reference lib="WebWorker" />
/**
 * Research-only Web Worker for the full-wave PML eigensolver.
 *
 * This is a self-contained replica of the `fullwave` route that
 * used to live in `src/workers/femWorker.ts`. Pulled out into
 * `research/` when the experimental page was shelved so the
 * production worker (which ships in the v0.1+KJ release) stays
 * lean. To resume development, re-wire this worker into the
 * production app via:
 *
 *   1. Import `useFullWaveCalc` somewhere (a page, button, etc.).
 *   2. The hook already points at this researchWorker, so no
 *      production-side changes are needed unless you want to
 *      consolidate workers later.
 */

import { hammerstadJensen } from '../../../src/analytical/hammerstad';
import { dispersionCorrection } from '../../../src/analytical/dispersion';
import { extractMicrostripZ0 } from '../fem-fullwave/microstrip-z0';
import { solveMicrostripPml } from '../fem-fullwave/microstrip-pml';
import type {
  ProgressStage,
  WorkerRequest,
  WorkerResponse,
} from './messages';

const C_MM_PER_S = 2.998e11;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    message,
    transfer ?? [],
  );
}

function progress(id: number, stage: ProgressStage): void {
  post({ id, type: 'progress', stage });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = event.data;
  const { id } = msg;
  try {
    progress(id, 'init');

    if (msg.type === 'fullwave') {
      progress(id, 'meshing-and-solving');
      const startedAt = performance.now();
      const fGHz = msg.frequencyGHz;
      const k0 = (2 * Math.PI * fGHz * 1e9) / C_MM_PER_S;
      const k0sq = k0 * k0;
      const kjStatic = hammerstadJensen(msg.params);
      const kjDisp = dispersionCorrection({
        epsilonR: msg.params.epsilonR,
        epsilonEffStatic: kjStatic.epsilonEff,
        widthMm: msg.params.width,
        heightMm: msg.params.height,
        frequencyGHz: fGHz,
      });
      const shiftReal = 1.3 * k0sq * kjDisp.epsilonEffF;
      const shiftImag = 0.3 * k0sq;
      const geometry = msg.coarseGeometry !== false
        ? {
            lateralPaddingFactor: 3,
            airPaddingFactor: 3,
            substrateMaxArea: 0.5,
            airMaxArea: 1.5,
          }
        : {};
      const eig = await solveMicrostripPml(msg.params, {
        frequencyGHz: fGHz,
        geometry,
        pmlKappaMax: 3,
        shift: { re: shiftReal, im: shiftImag },
        outerTol: 1e-3,
        outerMaxIter: 30,
        innerTol: 1e-4,
        innerMaxIter: 30000,
      });
      const z = extractMicrostripZ0(eig.mesh, eig.topology, {
        eFreeEdges: eig.eFreeEdges,
        eFreeNodes: eig.eFreeNodes,
        edgePartition: eig.edgePartition,
        nodePartition: eig.nodePartition,
        beta2: eig.beta2,
        k0Squared: eig.k0Squared,
        frequencyGHz: fGHz,
        traceWidth: msg.params.width,
        substrateHeight: msg.params.height,
        conductorThickness: msg.params.thickness,
      });
      const elapsedMs = performance.now() - startedAt;
      post({
        id,
        type: 'fullwave-result',
        paramsUsed: msg.params,
        frequencyGHz: fGHz,
        beta2: eig.beta2,
        epsilonEff: z.epsilonEff,
        z0: z.z0,
        kjReferenceEpsEff: kjDisp.epsilonEffF,
        kjReferenceZ0: kjStatic.z0 * kjDisp.z0Ratio,
        outerIterations: eig.outerIterations,
        innerIterations: eig.innerIterations,
        converged: eig.converged,
        elapsedMs,
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
