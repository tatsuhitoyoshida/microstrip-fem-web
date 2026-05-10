/**
 * Complex shift-invert generalised eigensolver (Round 8c Stage 3a-v-c).
 *
 * For a complex *symmetric* generalised eigenvalue problem
 *
 *     A · x  =  λ · B · x,
 *
 * find the (complex) eigenvalue λ closest to a user-supplied complex
 * shift σ. PML waveguide problems land here: A and B are complex
 * symmetric (A = Aᵀ but A ≠ A^H), σ is generically complex with a
 * small imaginary part absorbing the radiation loss, and λ = β² is
 * the complex propagation constant squared.
 *
 * Algorithm: power iteration on the shift-invert operator
 *
 *     T_σ  =  (A − σ B)⁻¹ · B,
 *
 * which has the same eigenvectors as (A, B) and eigenvalues
 * 1 / (λ − σ). The eigenvalue of (A, B) closest to σ becomes the
 * dominant mode of T_σ in absolute magnitude. Per outer step:
 *
 *   1. y  =  (A − σ B)⁻¹ B x_k     via complex Bi-CGSTAB
 *   2. y  ←  P_perp y               (gradient deflator if supplied)
 *   3. μ  =  cdot(x_k, B y) / cdot(x_k, B x_k)
 *      (bilinear inner product: complex symmetric A and B make `cdot`,
 *      not `cdotH`, the natural Rayleigh-quotient form)
 *   4. λ  =  σ + 1/μ
 *   5. x  ←  y / ‖y‖₂              (Hermitian normalisation, real)
 *
 * Mixing the bilinear cdot for Rayleigh and the Hermitian cnorm2 for
 * scaling is intentional: the bilinear form is what converges to the
 * right complex eigenvalue, but it can vanish or become very small
 * mid-iteration, which would underflow if we tried to normalise by
 * `sqrt(cdot(x, Bx))`. The Hermitian 2-norm stays strictly positive
 * for a non-zero vector and gives the Rayleigh quotient a stable
 * scale to live on.
 */

import {
  cabs,
  cdot,
  cdiv,
  cnorm2,
  ComplexCooBuilder,
  cspmv,
  type Complex,
  type ComplexCsrMatrix,
} from './complex-sparse';
import { solveCBicgstab } from './complex-solver';

export interface ComplexShiftInvertOptions {
  /** Complex shift σ. The returned eigenvalue is the (A, B)-eigenvalue
   *  closest to σ in absolute distance. Avoid landing exactly on an
   *  eigenvalue — that makes (A − σB) singular. */
  shift: Complex;
  /**
   * Optional complex gradient deflator. Each iterate is projected onto
   * the M-orthogonal complement of the gradient subspace before the
   * Rayleigh quotient is computed. Required for curl-curl / vector
   * Helmholtz operators where the gradient subspace is in the null
   * space of A.
   */
  deflator?: ComplexGradientDeflator;
  /** Tolerance on relative |Δλ|. Default 1e-8. */
  tol?: number;
  /** Maximum outer iterations. Default 200. */
  maxIter?: number;
  /** Inner Bi-CGSTAB tolerance. Default 1e-10. */
  innerTol?: number;
  /** Inner Bi-CGSTAB iteration cap. Defaults to BiCGStab's own default
   *  (4·n). Set higher for ill-conditioned systems where stagnation is
   *  the convergence failure mode. */
  innerMaxIter?: number;
  /** Initial guess (interleaved complex, length 2·n). Random if omitted. */
  initialGuess?: Float64Array;
}

/** Forward declaration of the deflator interface. The implementation
 *  lives in `complex-gradient.ts` (Stage 3a-v-c-2). */
export interface ComplexGradientDeflator {
  project(v: Float64Array): Float64Array;
}

export interface ComplexShiftInvertResult {
  eigenvalue: Complex;
  /** Hermitian-normalised eigenvector (interleaved complex, length 2·n). */
  eigenvector: Float64Array;
  iterations: number;
  innerIterations: number;
  converged: boolean;
}

/**
 * Build C = A − σ B as a fresh complex CSR. Both inputs must be
 * square and the same size; the result preserves their joint
 * sparsity pattern.
 */
function buildShiftedComplexMatrix(
  A: ComplexCsrMatrix,
  sigma: Complex,
  B: ComplexCsrMatrix,
): ComplexCsrMatrix {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols) {
    throw new Error('buildShiftedComplexMatrix: A and B must be square');
  }
  if (A.numRows !== B.numRows) {
    throw new Error(
      `buildShiftedComplexMatrix: size mismatch A=${A.numRows}, B=${B.numRows}`,
    );
  }
  const n = A.numRows;
  const builder = new ComplexCooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k++) {
      builder.add(i, A.colIdx[k]!, A.values[2 * k]!, A.values[2 * k + 1]!);
    }
    for (let k = B.rowPtr[i]!; k < B.rowPtr[i + 1]!; k++) {
      const bRe = B.values[2 * k]!;
      const bIm = B.values[2 * k + 1]!;
      // -σ · B[i, k] (complex multiply)
      const negRe = -(sigma.re * bRe - sigma.im * bIm);
      const negIm = -(sigma.re * bIm + sigma.im * bRe);
      builder.add(i, B.colIdx[k]!, negRe, negIm);
    }
  }
  return builder.toCsr();
}

/** Pseudo-random unit-norm complex vector (Hermitian 2-norm = 1).
 *  Deterministic seed for reproducible tests. */
function randomComplexUnitVector(twoN: number, seed = 0xc0ffee): Float64Array {
  let state = (seed | 0) || 1;
  const x = new Float64Array(twoN);
  let normSq = 0;
  for (let i = 0; i < twoN; i++) {
    state = Math.imul(state, 48271) | 0;
    if (state < 0) state += 0x80000000;
    const r = state / 0x80000000 - 0.5;
    x[i] = r;
    normSq += r * r;
  }
  const inv = 1 / Math.sqrt(normSq);
  for (let i = 0; i < twoN; i++) x[i] = x[i]! * inv;
  return x;
}

/**
 * Solve the complex generalised eigenvalue problem `A x = λ B x` for
 * the eigenvalue closest to `options.shift`.
 *
 * `A` and `B` must be square and the same size. They should be
 * complex symmetric (A = Aᵀ, B = Bᵀ) for the Rayleigh-quotient form
 * used here to give the right eigenvalue; for general non-symmetric
 * complex operators the algorithm still runs but converges to a
 * different (left/right Rayleigh) quantity.
 *
 * Throws on:
 *   - shape mismatch between A, B, the optional initial guess
 *   - inner Bi-CGSTAB divergence (typically σ landed on an eigenvalue)
 *   - cdot(x, Bx) → 0 mid-iteration (rare, but the Rayleigh denominator
 *     vanishing means we can't form μ; report rather than continue)
 */
export function shiftInvertEigenvalueComplex(
  A: ComplexCsrMatrix,
  B: ComplexCsrMatrix,
  options: ComplexShiftInvertOptions,
): ComplexShiftInvertResult {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols || A.numRows !== B.numRows) {
    throw new Error(
      `shiftInvertEigenvalueComplex: A is ${A.numRows}×${A.numCols}, B is ${B.numRows}×${B.numCols}; both must be square and same size`,
    );
  }
  const n = A.numRows;
  const sigma = options.shift;
  const tol = options.tol ?? 1e-8;
  const maxIter = options.maxIter ?? 200;
  const innerTol = options.innerTol ?? 1e-10;
  const innerMaxIter = options.innerMaxIter;
  const deflator = options.deflator;

  const Ashift = buildShiftedComplexMatrix(A, sigma, B);

  // Initial guess (Hermitian unit-norm). Apply deflator first so the
  // starting direction lives in V_perp; otherwise the very first
  // Rayleigh quotient may pick up a gradient-mode bias.
  let x = options.initialGuess
    ? new Float64Array(options.initialGuess)
    : randomComplexUnitVector(2 * n);
  if (options.initialGuess && options.initialGuess.length !== 2 * n) {
    throw new Error(
      `shiftInvertEigenvalueComplex: initialGuess length ${options.initialGuess.length} ≠ ${2 * n}`,
    );
  }
  if (deflator) x = deflator.project(x);
  const x0Norm = cnorm2(x);
  if (x0Norm === 0) {
    throw new Error(
      'shiftInvertEigenvalueComplex: initial vector has zero Hermitian norm (deflator may have annihilated it)',
    );
  }
  const xInv = 1 / x0Norm;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * xInv;

  let lambda: Complex = { re: NaN, im: NaN };
  let innerIterTotal = 0;
  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    // rhs = B · x_k
    const rhs = cspmv(B, x);

    // Inner solve: (A − σB) y = rhs
    const inner = solveCBicgstab(Ashift, rhs, {
      tol: innerTol,
      ...(innerMaxIter !== undefined ? { maxIter: innerMaxIter } : {}),
    });
    if (!inner.converged) {
      throw new Error(
        `shiftInvertEigenvalueComplex: inner Bi-CGSTAB did not converge ` +
          `(rel residual ${inner.relResidual.toExponential(2)} after ${inner.iterations} iter)`,
      );
    }
    innerIterTotal += inner.iterations;
    let y = inner.x;
    if (deflator) y = deflator.project(y);

    // Rayleigh quotient (bilinear): μ = cdot(x, B y) / cdot(x, B x).
    const xBx = cdot(x, rhs); // = cdot(x, B x_k)
    if (cabs(xBx) < 1e-300) {
      throw new Error(
        `shiftInvertEigenvalueComplex: bilinear cdot(x, Bx) ≈ 0 at iter ${iter} ` +
          `(B-isotropic eigenvector? choose a different initial guess)`,
      );
    }
    const By = cspmv(B, y);
    const xBy = cdot(x, By);
    const mu = cdiv(xBy, xBx);
    if (cabs(mu) < 1e-300) {
      throw new Error(
        `shiftInvertEigenvalueComplex: Rayleigh μ ≈ 0 at iter ${iter}`,
      );
    }
    // λ = σ + 1/μ. With Complex one-divided-by-z = z̄ / |z|².
    const muMagSq = mu.re * mu.re + mu.im * mu.im;
    const newLambda: Complex = {
      re: sigma.re + mu.re / muMagSq,
      im: sigma.im + -mu.im / muMagSq,
    };

    // Hermitian-normalise y. Stays well-defined for any non-zero
    // complex vector (unlike sqrt(cdot(y, By)) which can vanish).
    const yNorm = cnorm2(y);
    if (yNorm === 0) {
      throw new Error(
        `shiftInvertEigenvalueComplex: y → 0 at iter ${iter} (deflator wiped it?)`,
      );
    }
    const yInv = 1 / yNorm;
    for (let i = 0; i < y.length; i++) y[i] = y[i]! * yInv;
    x = y;

    if (Number.isFinite(lambda.re)) {
      const dRe = newLambda.re - lambda.re;
      const dIm = newLambda.im - lambda.im;
      const deltaMag = Math.hypot(dRe, dIm);
      const lambdaMag = Math.hypot(newLambda.re, newLambda.im);
      if (deltaMag <= tol * Math.max(lambdaMag, 1e-300)) {
        lambda = newLambda;
        converged = true;
        iter++;
        break;
      }
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
