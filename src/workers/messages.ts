/**
 * Shared message types for the FEM Web Worker. Both the worker and the
 * React hook import from this module so the postMessage protocol is
 * type-checked end-to-end.
 */

import type { MicrostripSolveOptions, MicrostripSolveResult } from '../fem/tlanalysis';
import type { MicrostripParams, MicrostripResult } from '../types';

/** Coarse stage label for the loading indicator. */
export type ProgressStage = 'init' | 'meshing-and-solving' | 'searching' | 'adaptive-pass';

/**
 * Pass-by-pass snapshot streamed from the worker so the main thread can
 * (a) update the loading text, (b) render the live heatmap as the mesh
 * gets denser, and (c) keep the full per-pass mesh in memory so the user
 * can scrub back through the convergence history after the run finishes.
 *
 * The typed-array fields are transferred (not copied) by the worker via
 * postMessage's transfer list — see `femWorker.ts`.
 */
export interface AdaptivePassUpdate {
  pass: number;
  triangleCount: number;
  z0: number;
  epsilonEff: number;
  /** |Z₀_n − Z₀_{n−1}| [Ω], NaN for pass 0. */
  deltaZ0: number;
  /** [x0, y0, x1, y1, ...] vertex coordinates. */
  vertices: Float64Array;
  /** [v0, v1, v2, ...] triangle vertex indices. */
  triangles: Int32Array;
  /** Nodal potential φ for the dielectric solve. */
  phi: Float64Array;
  /** Outer bounding box of the computational domain. */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

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
      /** Relative bisection tolerance (fraction, e.g. 0.01 = ±1 %). */
      tolerancePct?: number;
      /**
       * Operating frequency in GHz. When > 0 the bisection targets the
       * KJ-dispersion-corrected Z₀(f) instead of the static Z₀_qs from
       * FEM. See `bisection.BisectionOptions.frequencyGHz` for details.
       */
      frequencyGHz?: number;
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
  /** What ±-band the bisection actually targeted. */
  targetBand: { targetZ0: number; pct: number; low: number; high: number };
}

export interface ProgressMessage {
  id: number;
  type: 'progress';
  stage: ProgressStage;
  /** Present when `stage === 'adaptive-pass'`. */
  adaptive?: AdaptivePassUpdate;
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
