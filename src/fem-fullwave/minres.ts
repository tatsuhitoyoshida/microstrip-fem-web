/**
 * MINRES (Minimum Residual) solver for symmetric **indefinite** linear
 * systems Ax = b.
 *
 * Why this exists alongside the project's existing CG (`src/fem/solver.ts`):
 *
 *   - CG only works when A is symmetric **positive-definite**. The
 *     vector-Helmholtz mixed system has K_zz blocks like
 *     ∫(1/µr) ∇φ·∇φ − k₀² εr ∫φφ that are routinely sign-indefinite
 *     for ω above the lowest cavity cutoff. CG diverges (or worse,
 *     declares spurious convergence) on those.
 *   - MINRES needs only symmetry + non-singularity, and converges
 *     monotonically in 2-norm of the residual. Same matvec budget
 *     per step as CG, ~2× the auxiliary storage.
 *
 * Algorithm follows Paige & Saunders (1975), as documented in
 * SciPy's `minres` and Saad §6.7.3. The implementation tracks:
 *
 *   - the last two un-normalised Lanczos vectors (r1, r2)
 *   - the last two solution-update vectors (w, w2)
 *   - a running QR factorisation of the tridiagonal via Givens
 *     rotations (cs, sn carry the most recent rotation)
 *
 * That keeps memory at O(n) regardless of iteration count.
 *
 * Reference:
 *   C. C. Paige and M. A. Saunders, "Solution of Sparse Indefinite
 *   Systems of Linear Equations," SIAM J. Numer. Anal. 12, 617 (1975).
 */

import { type CsrMatrix, dot, spmv } from '../fem/sparse';

export interface MinresOptions {
  /**
   * Convergence tolerance on the residual proxy `phibar / β₁`.
   * Default 1e-10 (matches the project's CG default).
   */
  tol?: number;
  /** Iteration cap. Default 4·n. */
  maxIter?: number;
  /** Optional initial guess. Defaults to the zero vector. */
  initialGuess?: Float64Array;
}

export interface MinresResult {
  x: Float64Array;
  iterations: number;
  /** Final relative residual (phibar / ‖b‖). */
  relResidual: number;
  converged: boolean;
}

/**
 * Solve A x = b for symmetric A (positive- or sign-indefinite). Throws
 * if A is non-square or sizes mismatch.
 */
export function solveMinres(
  A: CsrMatrix,
  b: Float64Array,
  options: MinresOptions = {},
): MinresResult {
  if (A.numRows !== A.numCols) {
    throw new Error(`solveMinres: matrix must be square, got ${A.numRows}×${A.numCols}`);
  }
  const n = A.numRows;
  if (b.length !== n) {
    throw new Error(`solveMinres: A is ${n}×${n} but b has length ${b.length}`);
  }
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 4 * n;

  const x = new Float64Array(n);
  if (options.initialGuess) {
    if (options.initialGuess.length !== n) {
      throw new Error('solveMinres: initialGuess length mismatch');
    }
    x.set(options.initialGuess);
  }

  // r1 = b - A x_0  (initial residual)
  const r1 = new Float64Array(b);
  if (options.initialGuess) {
    const Ax = spmv(A, x);
    for (let i = 0; i < n; i++) r1[i] = r1[i]! - Ax[i]!;
  }

  const beta1 = Math.sqrt(dot(r1, r1));
  if (beta1 === 0) {
    return { x, iterations: 0, relResidual: 0, converged: true };
  }

  // Lanczos state
  let oldb = 0;
  let beta = beta1;
  // QR / rotation state
  let dbar = 0;
  let epsln = 0;
  let phibar = beta1;
  let cs = -1;
  let sn = 0;

  // Lanczos vectors: r1Prev = β_{j-1} v_{j-1}, r2 = β_j v_j (un-normalised).
  // r2 carries the current iterate's contribution; the contents are
  // updated in place via .set() each loop, so the binding stays const.
  const r2 = new Float64Array(r1);
  const r1Prev = new Float64Array(n); // β_{j-1} v_{j-1}, starts at zero

  // Solution-update directions: w_{j-2}, w_{j-1}, w_j. `w` is rewritten
  // in place each iteration, `w2` is reassigned via Float64Array.from.
  const w = new Float64Array(n);
  let w2 = new Float64Array(n);

  let iter = 0;
  let converged = false;
  let relRes = 1;

  for (; iter < maxIter; iter++) {
    // v = r2 / beta  (this is the next Lanczos basis vector)
    const v = new Float64Array(n);
    const sInv = 1 / beta;
    for (let i = 0; i < n; i++) v[i] = sInv * r2[i]!;

    // y = A v (will become the next un-normalised vector after orthogonalisation)
    const y = spmv(A, v);

    // Orthogonalise against the previous-previous Lanczos vector. After
    // the first iteration, r1Prev holds (β_{j-1} v_{j-1}); subtracting
    // (β_j / β_{j-1}) · that recovers β_j v_{j-1} → standard Lanczos.
    if (iter > 0) {
      const factor = beta / oldb;
      for (let i = 0; i < n; i++) y[i] = y[i]! - factor * r1Prev[i]!;
    }

    const alfa = dot(v, y);

    // Subtract diagonal contribution: y -= (alfa / beta) · r2
    const factor2 = alfa / beta;
    for (let i = 0; i < n; i++) y[i] = y[i]! - factor2 * r2[i]!;

    // Roll the Lanczos vectors forward: r1Prev ← r2, r2 ← y.
    r1Prev.set(r2);
    r2.set(y);
    oldb = beta;
    beta = Math.sqrt(dot(r2, r2));

    // ── Apply the previous rotation Q_{k-1} to the new tridiagonal column
    const oldeps = epsln;
    const delta = cs * dbar + sn * alfa;
    const gbar = sn * dbar - cs * alfa;
    epsln = sn * beta;
    dbar = -cs * beta;

    // ── New Givens rotation to zero the sub-diagonal `beta` entry
    const gamma = Math.max(Math.sqrt(gbar * gbar + beta * beta), Number.EPSILON);
    cs = gbar / gamma;
    sn = beta / gamma;
    const phi = cs * phibar;
    phibar = sn * phibar;

    // ── Update solution: w_j is the back-substituted column of QR
    const denom = 1 / gamma;
    const w1Prev = new Float64Array(w2);
    w2 = new Float64Array(w);
    for (let i = 0; i < n; i++) {
      w[i] = (v[i]! - oldeps * w1Prev[i]! - delta * w2[i]!) * denom;
    }
    for (let i = 0; i < n; i++) x[i] = x[i]! + phi * w[i]!;

    // Convergence proxy: phibar tracks the residual norm.
    relRes = phibar / beta1;
    if (relRes <= tol) {
      converged = true;
      iter++;
      break;
    }

    // Safeguard: if beta has collapsed to zero, we've found an exact
    // Krylov-space invariant subspace and the current x is exact.
    if (beta === 0) {
      converged = true;
      iter++;
      break;
    }
  }

  return { x, iterations: iter, relResidual: relRes, converged };
}
