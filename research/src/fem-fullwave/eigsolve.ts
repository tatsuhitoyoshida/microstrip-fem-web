/**
 * Generalised symmetric eigenvalue solver for the scalar-Helmholtz
 * problem (Round 8b).
 *
 * Given symmetric, positive-definite sparse matrices A and B, find the
 * **smallest** eigenvalue λ and eigenvector x of
 *
 *     A · x  =  λ · B · x
 *
 * via inverse iteration:
 *
 *     y_{k+1}  =  A⁻¹ · B · x_k          (linear solve, CG)
 *     x_{k+1}  =  y_{k+1} / √(y_{k+1}ᵀ B y_{k+1})   (B-normalise)
 *     λ_{k+1}  =  1 / (x_kᵀ · B · y_{k+1})           (Rayleigh shift)
 *
 * Convergence rate is (λ₁/λ₂)^k geometric, so we get a few digits per
 * dozen iterations on well-separated spectra. The CG inner solve reuses
 * the project's existing Jacobi-PCG (`src/fem/solver.ts`) — A_free, the
 * Dirichlet-restricted stiffness, is SPD by construction so CG is the
 * right tool.
 *
 * Future generalisations (Round 8b Stage 2+):
 *   - Shift-invert with σ ≠ 0 to find specific interior eigenvalues
 *   - Lanczos / IRAM for multiple modes simultaneously
 *   - The `A_factory(σ)` callback below leaves the door open for these.
 */

import { axpy, CooBuilder, type CsrMatrix, dot, spmv } from '../../../src/fem/sparse';
import { solveCgJacobi } from '../../../src/fem/solver';
import { solveMinres } from './minres';
import type { GradientDeflator } from './gradient';

export interface SmallestEigenOptions {
  /** Convergence tolerance on the relative change in λ. Default 1e-9. */
  tol?: number;
  /** Maximum outer (inverse-iteration) iterations. Default 100. */
  maxIter?: number;
  /** Tolerance for the inner CG solve. Default 1e-10. */
  innerTol?: number;
  /**
   * Initial guess (length n). Random unit vector when omitted. Useful
   * for restarting from a previous solve at a nearby ω.
   */
  initialGuess?: Float64Array;
}

export interface SmallestEigenResult {
  /** Smallest eigenvalue λ. */
  eigenvalue: number;
  /** Corresponding B-normalised eigenvector. Length n. */
  eigenvector: Float64Array;
  /** Number of inverse-iteration steps. */
  iterations: number;
  /** Total CG iterations across all inner solves (diagnostic). */
  innerIterations: number;
  /** True if the |Δλ| / |λ| residual fell below `tol`. */
  converged: boolean;
}

/** B-norm: sqrt(xᵀ B x). Returns NaN if the quadratic form is non-positive. */
function bNorm(B: CsrMatrix, x: Float64Array): number {
  const Bx = spmv(B, x);
  const v = dot(x, Bx);
  return v > 0 ? Math.sqrt(v) : Number.NaN;
}

/** Scale a vector by 1/scalar, in-place. */
function scaleInPlace(x: Float64Array, scalar: number): void {
  const inv = 1 / scalar;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * inv;
}

/** Pseudo-random unit vector. Deterministic seed for reproducible tests. */
function randomUnitVector(n: number, seed = 0xc0ffee): Float64Array {
  // Lehmer LCG. Quality is fine for kicking inverse iteration off the
  // null space — we just need any vector with non-zero component along
  // every eigenvector of A.
  let state = (seed | 0) || 1;
  const x = new Float64Array(n);
  let normSq = 0;
  for (let i = 0; i < n; i++) {
    state = Math.imul(state, 48271) | 0;
    if (state < 0) state += 0x80000000;
    const r = state / 0x80000000 - 0.5;
    x[i] = r;
    normSq += r * r;
  }
  scaleInPlace(x, Math.sqrt(normSq));
  return x;
}

/**
 * Find the smallest eigenvalue and corresponding eigenvector of
 * `A x = λ B x` via inverse iteration.
 *
 * Both `A` and `B` are assumed symmetric positive-definite (after any
 * Dirichlet elimination — see `boundary.ts`). The function will throw
 * if the inner CG cannot solve `A y = B x` (typically a sign that A is
 * not SPD).
 */
export function smallestGeneralizedEigenvalue(
  A: CsrMatrix,
  B: CsrMatrix,
  options: SmallestEigenOptions = {},
): SmallestEigenResult {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols || A.numRows !== B.numRows) {
    throw new Error(
      `smallestGeneralizedEigenvalue: A is ${A.numRows}×${A.numCols}, ` +
        `B is ${B.numRows}×${B.numCols}; both must be square and same size`,
    );
  }
  const n = A.numRows;
  const tol = options.tol ?? 1e-9;
  const maxIter = options.maxIter ?? 100;
  const innerTol = options.innerTol ?? 1e-10;

  // Initial guess: random unit vector, then B-normalise.
  let x = options.initialGuess ? new Float64Array(options.initialGuess) : randomUnitVector(n);
  const x0Norm = bNorm(B, x);
  if (!Number.isFinite(x0Norm) || x0Norm === 0) {
    throw new Error('smallestGeneralizedEigenvalue: initial vector has zero / negative B-norm');
  }
  scaleInPlace(x, x0Norm);

  let lambda = Number.POSITIVE_INFINITY;
  let innerIterTotal = 0;
  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    // RHS: B · x_k
    const rhs = spmv(B, x);
    // Solve A y = rhs (CG with Jacobi preconditioner)
    const cg = solveCgJacobi(A, rhs, { tol: innerTol });
    if (!cg.converged) {
      throw new Error(
        `smallestGeneralizedEigenvalue: inner CG did not converge ` +
          `(rel residual ${cg.relResidual.toExponential(2)} after ${cg.iterations} iter)`,
      );
    }
    innerIterTotal += cg.iterations;
    const y = cg.x;

    // Rayleigh-shift estimate: λ ≈ 1 / (x_kᵀ · B · y_{k+1})
    // (= Rayleigh quotient for A on y, since A y = B x_k)
    const xBy = dot(x, rhs); // = x_kᵀ B x_k = 1 by construction (last B-norm)
    const yBx = dot(y, rhs); // = y_{k+1}ᵀ B x_k
    const newLambda = xBy / yBx;

    // Update x ← y / ||y||_B
    const yNorm = bNorm(B, y);
    if (!Number.isFinite(yNorm) || yNorm === 0) {
      throw new Error('smallestGeneralizedEigenvalue: y has zero / negative B-norm');
    }
    scaleInPlace(y, yNorm);
    x = y;

    if (Math.abs(newLambda - lambda) <= tol * Math.abs(newLambda)) {
      lambda = newLambda;
      converged = true;
      iter++;
      break;
    }
    lambda = newLambda;
  }

  return {
    eigenvalue: lambda,
    eigenvector: x,
    iterations: iter,
    innerIterations: innerIterTotal,
    converged,
  };
}

// Tiny helper used by the boundary / scatter logic; kept here to avoid
// a dedicated utils module just for one function.
export { axpy };

// ─────────────────────────────────────────────────────────────────────
// Shift-invert variant for indefinite generalised eigenvalue problems
// (Round 8c Stage 2.3c).
//
// Used when:
//   - A is symmetric but **not** SPD (e.g. K_curl, which is rank-
//     deficient), so the inner solve must use MINRES;
//   - we want the eigenvalue closest to a target shift σ (interior
//     mode) rather than the smallest;
//   - and/or the operator has a known null subspace (V_grad for
//     curl-curl) that needs to be projected out at every step.
//
// Algorithm: power iteration on the shift-invert operator
// T_σ = (A − σ B)⁻¹ B. T_σ is B-symmetric, so its eigenvectors agree
// with those of (A, B) and its eigenvalues are 1 / (λ − σ). The
// eigenvalue of (A, B) closest to σ becomes the dominant mode of T_σ.
//
// Per outer step:
//   1. y = (A − σ B)⁻¹ B x_k    via MINRES (symmetric indefinite)
//   2. y ← P_perp y             (drop gradient-subspace contamination)
//   3. μ = x_kᵀ B y             (Rayleigh quotient for T_σ; B-norm 1)
//   4. λ = σ + 1/μ              (shift-back)
//   5. x_{k+1} = y / ‖y‖_B
// ─────────────────────────────────────────────────────────────────────

export interface ShiftInvertOptions {
  /** Target shift σ. The returned eigenvalue is the (A, B)-eigenvalue
   *  closest to σ. Must not coincide exactly with an eigenvalue (the
   *  inner MINRES would face a singular operator). */
  shift: number;
  /** Optional gradient deflator. When provided, every iterate is
   *  projected onto the M-orthogonal complement of the gradient
   *  subspace, which is essential for curl-curl operators. */
  deflator?: GradientDeflator;
  /** Convergence tolerance on the relative change in λ. Default 1e-9. */
  tol?: number;
  /** Maximum outer (power-iteration) steps. Default 100. */
  maxIter?: number;
  /** MINRES residual tolerance. Default 1e-10. */
  innerTol?: number;
  /** MINRES iteration cap. Default 4·n (delegated to MINRES). */
  innerMaxIter?: number;
  /** Initial guess; random unit vector if omitted. */
  initialGuess?: Float64Array;
}

export interface ShiftInvertResult {
  /** Eigenvalue closest to σ. */
  eigenvalue: number;
  /** Corresponding B-normalised eigenvector. */
  eigenvector: Float64Array;
  /** Outer iteration count. */
  iterations: number;
  /** Sum of MINRES iterations across all outer steps (diagnostic). */
  innerIterations: number;
  /** True if relative |Δλ| fell below `tol`. */
  converged: boolean;
}

/**
 * Build C = A − σ B as a fresh CSR matrix. Both inputs must be square
 * and the same size; the result preserves their joint symmetry pattern.
 * Allocates O(nnz(A) + nnz(B)) intermediate storage; for the FEM scale
 * (≤ ~1e5 nnz) this is a negligible one-shot cost per solve.
 */
function buildShiftedMatrix(A: CsrMatrix, sigma: number, B: CsrMatrix): CsrMatrix {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols) {
    throw new Error('buildShiftedMatrix: A and B must be square');
  }
  if (A.numRows !== B.numRows) {
    throw new Error(
      `buildShiftedMatrix: size mismatch A=${A.numRows}, B=${B.numRows}`,
    );
  }
  const n = A.numRows;
  const builder = new CooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k++) {
      builder.add(i, A.colIdx[k]!, A.values[k]!);
    }
    for (let k = B.rowPtr[i]!; k < B.rowPtr[i + 1]!; k++) {
      builder.add(i, B.colIdx[k]!, -sigma * B.values[k]!);
    }
  }
  return builder.toCsr();
}

/**
 * Solve A x = λ B x for the eigenvalue closest to `options.shift` via
 * MINRES-based shift-invert iteration. Symmetry of A and B is required;
 * SPD-ness of B is required; A may be sign-indefinite or rank-deficient
 * (in which case `options.deflator` must be supplied).
 *
 * Throws if MINRES diverges or the iterate's B-norm collapses (typical
 * sign that σ landed on an eigenvalue or that the deflator is mis-built).
 */
export function shiftInvertEigenvalue(
  A: CsrMatrix,
  B: CsrMatrix,
  options: ShiftInvertOptions,
): ShiftInvertResult {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols || A.numRows !== B.numRows) {
    throw new Error(
      `shiftInvertEigenvalue: A is ${A.numRows}×${A.numCols}, ` +
        `B is ${B.numRows}×${B.numCols}; both must be square and same size`,
    );
  }
  const n = A.numRows;
  const sigma = options.shift;
  const tol = options.tol ?? 1e-9;
  const maxIter = options.maxIter ?? 100;
  const innerTol = options.innerTol ?? 1e-10;
  const innerMaxIter = options.innerMaxIter;
  const deflator = options.deflator;

  const Ashift = buildShiftedMatrix(A, sigma, B);

  // Initial guess: deflate first (so the initial direction is in V_perp
  // already), then B-normalise.
  let x = options.initialGuess
    ? new Float64Array(options.initialGuess)
    : randomUnitVector(n);
  if (deflator) x = deflator.project(x);
  const x0Norm = bNorm(B, x);
  if (!Number.isFinite(x0Norm) || x0Norm === 0) {
    throw new Error(
      'shiftInvertEigenvalue: initial vector has zero / negative B-norm ' +
        '(deflator may have annihilated it)',
    );
  }
  scaleInPlace(x, x0Norm);

  let lambda = Number.NaN;
  let innerIterTotal = 0;
  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    // RHS of the inner solve: B · x_k
    const rhs = spmv(B, x);

    const ms = solveMinres(Ashift, rhs, {
      tol: innerTol,
      ...(innerMaxIter !== undefined ? { maxIter: innerMaxIter } : {}),
    });
    if (!ms.converged) {
      throw new Error(
        `shiftInvertEigenvalue: inner MINRES did not converge ` +
          `(rel residual ${ms.relResidual.toExponential(2)} after ${ms.iterations} iter)`,
      );
    }
    innerIterTotal += ms.iterations;
    let y = ms.x;
    if (deflator) y = deflator.project(y);

    // Rayleigh quotient for T_σ = (A − σB)⁻¹ B in the B inner product:
    //   μ = (x_kᵀ B y) / (x_kᵀ B x_k)  =  x_kᵀ B y   (x_k is B-normalised)
    // Then the (A, B) eigenvalue is λ = σ + 1/μ.
    const mu = dot(rhs, y); // = x_kᵀ B y
    if (mu === 0) {
      throw new Error(
        'shiftInvertEigenvalue: Rayleigh quotient is zero (σ may equal an eigenvalue)',
      );
    }
    const newLambda = sigma + 1 / mu;

    const yNorm = bNorm(B, y);
    if (!Number.isFinite(yNorm) || yNorm === 0) {
      throw new Error(
        'shiftInvertEigenvalue: y has zero / negative B-norm after deflation',
      );
    }
    scaleInPlace(y, yNorm);
    x = y;

    if (
      Number.isFinite(lambda) &&
      Math.abs(newLambda - lambda) <= tol * Math.abs(newLambda)
    ) {
      lambda = newLambda;
      converged = true;
      iter++;
      break;
    }
    lambda = newLambda;
  }

  return {
    eigenvalue: lambda,
    eigenvector: x,
    iterations: iter,
    innerIterations: innerIterTotal,
    converged,
  };
}
