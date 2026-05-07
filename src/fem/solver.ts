/**
 * Preconditioned Conjugate Gradient solver for symmetric positive-definite
 * sparse systems.
 *
 * Why CG and not a direct sparse Cholesky? The published `eigen` WASM
 * package does not expose `SimplicialLDLT` (CLAUDE.md §3 was wrong on the
 * package name and on the available solvers — see Phase 3 spec note).
 * For ~10k-DOF microstrip problems CG with a Jacobi (diagonal)
 * preconditioner is empirically sub-second in the browser; revisit with
 * IC(0) or a self-built sparse LDLT if profiling demands it.
 *
 * Algorithm (Saad, 2003 §6.7.1):
 *   r₀ = b − K x₀
 *   z₀ = M⁻¹ r₀,  p₀ = z₀,  ρ₀ = r₀ · z₀
 *   for k = 0, 1, …
 *       Kp  = K p_k
 *       α   = ρ_k / (p_k · Kp)
 *       x_{k+1} = x_k + α p_k
 *       r_{k+1} = r_k − α Kp
 *       if ‖r_{k+1}‖ < tol · ‖b‖ : stop
 *       z_{k+1} = M⁻¹ r_{k+1}
 *       β   = (r_{k+1} · z_{k+1}) / ρ_k
 *       p_{k+1} = z_{k+1} + β p_k
 *       ρ_{k+1} = r_{k+1} · z_{k+1}
 */

import { axpy, type CsrMatrix, diagonal, dot, spmv, xpay } from './sparse';

export interface CgOptions {
  /** Relative residual tolerance ‖r‖ / ‖b‖. Default 1e-10. */
  tol?: number;
  /** Maximum CG iterations. Default 4 × n. */
  maxIter?: number;
  /** Optional initial guess. Default zero vector. */
  initialGuess?: Float64Array;
}

export interface CgResult {
  x: Float64Array;
  iterations: number;
  /** ‖r‖ / ‖b‖ at termination. */
  relResidual: number;
  /** True if `relResidual <= tol`. */
  converged: boolean;
}

/**
 * Solve K x = b for symmetric positive-definite K with Jacobi-preconditioned
 * conjugate gradients.
 */
export function solveCgJacobi(K: CsrMatrix, b: Float64Array, options: CgOptions = {}): CgResult {
  const n = K.n;
  if (b.length !== n) {
    throw new Error(`solveCgJacobi: K is ${n}×${n} but b has length ${b.length}`);
  }
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 4 * n;

  const diag = diagonal(K);
  for (let i = 0; i < n; i++) {
    if (diag[i] === 0) {
      throw new Error(`solveCgJacobi: zero diagonal at row ${i} (matrix not SPD?)`);
    }
  }

  const x = new Float64Array(n);
  if (options.initialGuess) {
    if (options.initialGuess.length !== n) {
      throw new Error('solveCgJacobi: initialGuess length mismatch');
    }
    x.set(options.initialGuess);
  }

  // r = b - K x
  const r = new Float64Array(b);
  if (options.initialGuess) {
    const Kx = spmv(K, x);
    axpy(-1, Kx, r);
  }

  const bNorm = Math.sqrt(dot(b, b));
  if (bNorm === 0) {
    return { x, iterations: 0, relResidual: 0, converged: true };
  }

  // z = M⁻¹ r  (Jacobi)
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = r[i]! / diag[i]!;

  const p = new Float64Array(z);
  let rho = dot(r, z);

  let iter = 0;
  let relRes = Math.sqrt(dot(r, r)) / bNorm;
  while (iter < maxIter && relRes > tol) {
    const Kp = spmv(K, p);
    const pKp = dot(p, Kp);
    if (pKp <= 0) {
      throw new Error(`solveCgJacobi: non-positive curvature pᵀKp = ${pKp} (matrix not SPD?)`);
    }
    const alpha = rho / pKp;
    axpy(alpha, p, x);
    axpy(-alpha, Kp, r);

    relRes = Math.sqrt(dot(r, r)) / bNorm;
    if (relRes <= tol) {
      iter++;
      break;
    }

    for (let i = 0; i < n; i++) z[i] = r[i]! / diag[i]!;
    const rhoNew = dot(r, z);
    const beta = rhoNew / rho;
    xpay(beta, z, p);
    rho = rhoNew;
    iter++;
  }

  return { x, iterations: iter, relResidual: relRes, converged: relRes <= tol };
}
