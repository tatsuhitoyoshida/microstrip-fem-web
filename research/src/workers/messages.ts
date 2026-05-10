/**
 * Shared message types for the **research** full-wave Web Worker.
 *
 * Mirrors the shape of the production `src/workers/messages.ts` but
 * scoped to the single `fullwave` request route. The production
 * worker no longer carries this path — it was removed when the
 * full-wave page was shelved.
 *
 * Kept self-contained inside `research/` so the research code
 * type-checks (and tests run) without depending on the production
 * worker, which is free to change shape on the KJ release path.
 */

import type { MicrostripParams } from '../../../src/types';

export type ProgressStage = 'init' | 'meshing-and-solving';

export interface FullWaveRequest {
  id: number;
  type: 'fullwave';
  params: MicrostripParams;
  frequencyGHz: number;
  coarseGeometry?: boolean;
}

export interface FullWaveResultMessage {
  id: number;
  type: 'fullwave-result';
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

export interface ProgressMessage {
  id: number;
  type: 'progress';
  stage: ProgressStage;
}

export interface ErrorMessage {
  id: number;
  type: 'error';
  message: string;
}

export type WorkerRequest = FullWaveRequest;
export type WorkerResponse =
  | FullWaveResultMessage
  | ProgressMessage
  | ErrorMessage;
