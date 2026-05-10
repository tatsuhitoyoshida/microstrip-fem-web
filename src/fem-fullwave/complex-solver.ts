/**
 * Complex linear solver for the PML path (Round 8c Stage 3a-ii).
 *
 * Why BiCGStab and not MINRES / CG: PML coordinate stretching yields
 * **complex symmetric** operators (A = Aᵀ, but A ≠ A^H). The standard
 * real-valued MINRES / CG family relies on Hermitian symmetry; on a
 * complex symmetric system MINRES's "minimum residual" property
 * decouples from the actual Hermitian residual norm because the
 * Lanczos basis is bi-orthogonal w.r.t. the bilinear form, not
 * orthonormal w.r.t. the Hermitian inner product.
 *
 * BiCGStab (van der Vorst, 1992) works for general non-Hermitian
 * matrices and tracks the real Hermitian 2-norm of the residual at
 * every step (true residual: r_k = b − A x_k recomputed implicitly).
 * Specialised complex-symmetric variants like COCG can be faster on
 * benign problems but break down on the indefinite shift-invert
 * systems we expect from PML eigenvalue solves; BiCGStab degrades
 * gracefully instead.
 *
 * Jacobi (diagonal) preconditioning is included by default — same
 * reasoning as the real `solveCgJacobi`: it's nearly free, often cuts
 * iteration count by a factor of 2-5, and never makes things worse on
 * well-scaled FEM operators.
 *
 * Reference: H. A. van der Vorst, "Bi-CGSTAB: A fast and smoothly
 * converging variant of Bi-CG for the solution of nonsymmetric linear
 * systems," SIAM J. Sci. Stat. Comp. 13, 631 (1992).
 */

import {
  cabs,
  caxpy,
  cdiagonal,
  cdiv,
  cdotH,
  cmul,
  cnorm2,
  cspmv,
  type Complex,
  type ComplexCsrMatrix,
} from './complex-sparse';

export interface CBicgstabOptions {
  /** Relative residual tolerance ‖r‖ / ‖b‖. Default 1e-10. */
  tol?: number;
  /** Iteration cap. Default 4·n. */
  maxIter?: number;
  /** Optional initial guess (interleaved complex). Defaults to zero. */
  initialGuess?: Float64Array;
  /** Apply Jacobi (diagonal) left-preconditioning. Default true. */
  preconditioned?: boolean;
}

export interface CBicgstabResult {
  x: Float64Array;
  iterations: number;
  /** Final relative residual ‖b − A x‖ / ‖b‖ (Hermitian 2-norm). */
  relResidual: number;
  converged: boolean;
}

/**
 * Solve `A x = b` for a complex (square) CSR matrix `A` via
 * preconditioned Bi-CGSTAB.
 *
 * No assumption is made about A's structure beyond being square and
 * non-singular. Complex symmetric, complex Hermitian, and general
 * non-Hermitian matrices all work — convergence rate varies, but the
 * algorithm itself is uniform.
 *
 * Throws on:
 *   - shape mismatch between A, b, x₀
 *   - "lucky" breakdown when ρ → 0 or (t, t) → 0 (BiCGStab's known
 *     fragility points; we surface them rather than silently
 *     producing garbage)
 */
export function solveCBicgstab(
  A: ComplexCsrMatrix,
  b: Float64Array,
  options: CBicgstabOptions = {},
): CBicgstabResult {
  if (A.numRows !== A.numCols) {
    throw new Error(`solveCBicgstab: matrix must be square, got ${A.numRows}×${A.numCols}`);
  }
  const n = A.numRows;
  if (b.length !== 2 * n) {
    throw new Error(`solveCBicgstab: A is ${n}×${n} but b has length ${b.length} (expected ${2 * n})`);
  }
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 4 * n;
  const usePrecond = options.preconditioned ?? true;

  // Jacobi preconditioner: M = diag(A). Apply M⁻¹ as element-wise
  // complex divide. If a diagonal entry is exactly zero we fall back
  // to identity at that index (no preconditioning there).
  let mInvDiag: Float64Array | null = null;
  if (usePrecond) {
    const mDiag = cdiagonal(A);
    mInvDiag = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const dRe = mDiag[2 * i]!;
      const dIm = mDiag[2 * i + 1]!;
      const denom = dRe * dRe + dIm * dIm;
      if (denom === 0) {
        mInvDiag[2 * i] = 1;
        mInvDiag[2 * i + 1] = 0;
      } else {
        mInvDiag[2 * i] = dRe / denom;
        mInvDiag[2 * i + 1] = -dIm / denom;
      }
    }
  }

  /** y ← M⁻¹ x  (or y ← x when no preconditioning). */
  const applyPrecond = (x: Float64Array, y: Float64Array): void => {
    if (!mInvDiag) {
      y.set(x);
      return;
    }
    for (let i = 0; i < n; i++) {
      const xRe = x[2 * i]!;
      const xIm = x[2 * i + 1]!;
      const mRe = mInvDiag[2 * i]!;
      const mIm = mInvDiag[2 * i + 1]!;
      y[2 * i] = mRe * xRe - mIm * xIm;
      y[2 * i + 1] = mRe * xIm + mIm * xRe;
    }
  };

  // Initial guess.
  const x = new Float64Array(2 * n);
  if (options.initialGuess) {
    if (options.initialGuess.length !== 2 * n) {
      throw new Error('solveCBicgstab: initialGuess length mismatch');
    }
    x.set(options.initialGuess);
  }

  // r = b − A x₀
  const r = new Float64Array(b);
  if (options.initialGuess) {
    const Ax = cspmv(A, x);
    for (let i = 0; i < 2 * n; i++) r[i] = r[i]! - Ax[i]!;
  }

  const bnorm = cnorm2(b);
  if (bnorm === 0) {
    return { x, iterations: 0, relResidual: 0, converged: true };
  }
  let rNorm = cnorm2(r);
  let relRes = rNorm / bnorm;
  if (relRes <= tol) {
    return { x, iterations: 0, relResidual: relRes, converged: true };
  }

  // Shadow residual r̃₀ — fixed throughout the run. The choice
  // r̃₀ = r₀ is canonical and works for the vast majority of systems.
  const r0 = new Float64Array(r);

  let rho: Complex = { re: 1, im: 0 };
  let alpha: Complex = { re: 1, im: 0 };
  let omega: Complex = { re: 1, im: 0 };

  const v = new Float64Array(2 * n);
  const p = new Float64Array(2 * n);
  const ph = new Float64Array(2 * n); // M⁻¹ p   (preconditioned)
  const sh = new Float64Array(2 * n); // M⁻¹ s
  const s = new Float64Array(2 * n);
  const t = new Float64Array(2 * n);

  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    const rhoNew = cdotH(r0, r); // (r̃₀, r) — sesquilinear

    if (cabs(rhoNew) < 1e-300) {
      throw new Error(
        `solveCBicgstab: breakdown ρ ≈ 0 at iteration ${iter} ` +
          `(rel residual ${relRes.toExponential(2)})`,
      );
    }

    // β = (ρ_new / ρ_old) · (α / ω)
    const beta = cmul(cdiv(rhoNew, rho), cdiv(alpha, omega));

    // p ← r + β (p − ω v)
    for (let i = 0; i < n; i++) {
      const pRe = p[2 * i]!;
      const pIm = p[2 * i + 1]!;
      const vRe = v[2 * i]!;
      const vIm = v[2 * i + 1]!;
      // q = p − ω v
      const qRe = pRe - (omega.re * vRe - omega.im * vIm);
      const qIm = pIm - (omega.re * vIm + omega.im * vRe);
      // p ← r + β q
      const bqRe = beta.re * qRe - beta.im * qIm;
      const bqIm = beta.re * qIm + beta.im * qRe;
      p[2 * i] = r[2 * i]! + bqRe;
      p[2 * i + 1] = r[2 * i + 1]! + bqIm;
    }

    // v = A · M⁻¹ p
    applyPrecond(p, ph);
    cspmv(A, ph, v);

    // α = ρ_new / (r̃₀, v)
    const r0v = cdotH(r0, v);
    if (cabs(r0v) < 1e-300) {
      throw new Error(
        `solveCBicgstab: breakdown (r̃₀, v) ≈ 0 at iteration ${iter} ` +
          `(rel residual ${relRes.toExponential(2)})`,
      );
    }
    alpha = cdiv(rhoNew, r0v);

    // s = r − α v
    for (let i = 0; i < n; i++) {
      const vRe = v[2 * i]!;
      const vIm = v[2 * i + 1]!;
      const avRe = alpha.re * vRe - alpha.im * vIm;
      const avIm = alpha.re * vIm + alpha.im * vRe;
      s[2 * i] = r[2 * i]! - avRe;
      s[2 * i + 1] = r[2 * i + 1]! - avIm;
    }

    // Early exit: ‖s‖ already small.
    const sNorm = cnorm2(s);
    if (sNorm / bnorm <= tol) {
      // x ← x + α (M⁻¹ p)
      caxpy(alpha.re, alpha.im, ph, x);
      rNorm = sNorm;
      relRes = rNorm / bnorm;
      converged = true;
      iter++;
      break;
    }

    // t = A · M⁻¹ s
    applyPrecond(s, sh);
    cspmv(A, sh, t);

    // ω = (t, s) / (t, t)
    const ts = cdotH(t, s);
    const tt = cdotH(t, t);
    if (tt.re < 1e-300) {
      throw new Error(
        `solveCBicgstab: breakdown (t, t) ≈ 0 at iteration ${iter} ` +
          `(rel residual ${relRes.toExponential(2)})`,
      );
    }
    omega = cdiv(ts, tt);

    // x ← x + α (M⁻¹ p) + ω (M⁻¹ s)
    caxpy(alpha.re, alpha.im, ph, x);
    caxpy(omega.re, omega.im, sh, x);

    // r ← s − ω t
    for (let i = 0; i < n; i++) {
      const tRe = t[2 * i]!;
      const tIm = t[2 * i + 1]!;
      const otRe = omega.re * tRe - omega.im * tIm;
      const otIm = omega.re * tIm + omega.im * tRe;
      r[2 * i] = s[2 * i]! - otRe;
      r[2 * i + 1] = s[2 * i + 1]! - otIm;
    }

    rNorm = cnorm2(r);
    relRes = rNorm / bnorm;
    if (relRes <= tol) {
      converged = true;
      iter++;
      break;
    }

    // Stagnation guard: if |ω| is exactly zero the next iterate would
    // divide by zero in β.
    if (cabs(omega) < 1e-300) {
      throw new Error(
        `solveCBicgstab: breakdown ω ≈ 0 at iteration ${iter} ` +
          `(rel residual ${relRes.toExponential(2)})`,
      );
    }

    rho = rhoNew;
  }

  return { x, iterations: iter, relResidual: relRes, converged };
}
