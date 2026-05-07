/**
 * Shared message types for the FEM Web Worker. Both the worker and the
 * React hook import from this module so the postMessage protocol is
 * type-checked end-to-end.
 */

import type { MicrostripSolveOptions, MicrostripSolveResult } from '../fem/tlanalysis';
import type { MicrostripParams, MicrostripResult } from '../types';

/** Coarse stage label for the loading indicator. */
export type ProgressStage = 'init' | 'meshing-and-solving' | 'searching';

export type WorkerRequest =
  | {
      id: number;
      type: 'forward';
      params: MicrostripParams;
      options?: MicrostripSolveOptions;
    }
  | {
      id: number;
      type: 'findW';
      target: number;
      fixed: Omit<MicrostripParams, 'width'>;
      options?: MicrostripSolveOptions;
    };

export interface ForwardResultMessage {
  id: number;
  type: 'forward-result';
  fem: MicrostripSolveResult;
  hammerstad: MicrostripResult;
  wheeler: MicrostripResult;
  paramsUsed: MicrostripParams;
}

export interface FindWResultMessage {
  id: number;
  type: 'findW-result';
  fem: MicrostripSolveResult;
  hammerstad: MicrostripResult;
  wheeler: MicrostripResult;
  paramsUsed: MicrostripParams;
  optimalW: number;
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

export type WorkerResponse =
  | ForwardResultMessage
  | FindWResultMessage
  | ProgressMessage
  | ErrorMessage;
