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
    }
  | {
      id: number;
      type: 'fullwave';
      params: MicrostripParams;
      /** Operating frequency in GHz. Must be ≥ ~20 GHz for the current
       *  Jacobi-PCG inner solver to converge on a coarse mesh — see
       *  `docs/validation.md` for the convergence floor. */
      frequencyGHz: number;
      /** Optional mesh / geometry override. The defaults match what
       *  `microstrip-dispersion.test.ts` uses: lateral / air pad = 3·h,
       *  ≈ few hundred triangles. */
      coarseGeometry?: boolean;
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

/**
 * Full-wave PML eigenvalue result. Sent in reply to a `fullwave`
 * request. The eigenvalue β² is complex (im part ≈ radiation loss
 * absorbed by the PML), ε_eff is the dispersion-aware effective
 * permittivity, and Z₀ is the Voltage-Power characteristic
 * impedance — see `src/fem-fullwave/microstrip-z0.ts` for the
 * extraction details.
 *
 * `kjReferenceEpsEff` / `kjReferenceZ0` are the analytical
 * Kirschning–Jansen dispersion-corrected values at the same
 * frequency, surfaced alongside the FEM result so the UI can
 * present them side-by-side.
 */
export interface FullWaveResultMessage {
  id: number;
  type: 'fullwave-result';
  paramsUsed: MicrostripParams;
  frequencyGHz: number;
  /** β² in 1/mm² (complex). */
  beta2: { re: number; im: number };
  /** ε_eff(f) = β²/k₀² (complex). */
  epsilonEff: { re: number; im: number };
  /** Z₀ via the V-P definition [Ω]. */
  z0: number;
  /** KJ-dispersive ε_eff(f) at the same frequency (real reference). */
  kjReferenceEpsEff: number;
  /** KJ Z₀(f) at the same frequency [Ω]. */
  kjReferenceZ0: number;
  /** Outer / inner iteration counts for diagnostics. */
  outerIterations: number;
  innerIterations: number;
  /** Whether the outer shift-invert reached its tolerance. */
  converged: boolean;
  /** Wall-clock time spent inside the worker, in milliseconds. */
  elapsedMs: number;
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
  | FullWaveResultMessage
  | ProgressMessage
  | ErrorMessage;
