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

import { axpy, type CsrMatrix, dot, spmv } from '../fem/sparse';
import { solveCgJacobi } from '../fem/solver';

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
  if (A.n !== B.n) {
    throw new Error(`smallestGeneralizedEigenvalue: A is ${A.n}×${A.n}, B is ${B.n}×${B.n}`);
  }
  const n = A.n;
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
