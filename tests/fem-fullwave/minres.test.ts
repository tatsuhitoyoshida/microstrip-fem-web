// @vitest-environment node
/**
 * MINRES validation against problems CG can't touch.
 *
 * Three layers:
 *
 *   1. Symmetric **positive-definite** (sanity): MINRES should hit the
 *      same answer CG would, on the same matrix.
 *
 *   2. Symmetric **indefinite** (the whole reason we wrote MINRES):
 *      a 4×4 hand-built matrix with mixed-sign eigenvalues. Verifies
 *      ‖Ax − b‖ → 0 to ~1e-10.
 *
 *   3. The "almost singular at zero shift" case: A = K_stiff − k_0² M
 *      on a small mesh-like matrix where one eigenvalue is exactly the
 *      shift, making A indefinite with a tiny direction. Catches naïve
 *      CG-style breakdowns.
 */

import { describe, expect, it } from 'vitest';
import { CooBuilder, dot, spmv, type CsrMatrix } from '../../src/fem/sparse';
import { solveMinres } from '../../src/fem-fullwave/minres';

/** Build a small dense-style symmetric CSR from a 2-D number array. */
function symmetricFromDense(rows: number[][]): CsrMatrix {
  const n = rows.length;
  const builder = new CooBuilder(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = rows[i]![j]!;
      if (v !== 0) builder.add(i, j, v);
    }
  }
  return builder.toCsr();
}

/** Compute ‖Ax − b‖. */
function residualNorm(A: CsrMatrix, x: Float64Array, b: Float64Array): number {
  const Ax = spmv(A, x);
  const r = new Float64Array(b);
  for (let i = 0; i < b.length; i++) r[i] = r[i]! - Ax[i]!;
  return Math.sqrt(dot(r, r));
}

describe('MINRES — symmetric indefinite linear solver', () => {
  it('handles a tiny SPD system (sanity, also reachable by CG)', () => {
    // [4 1 0; 1 3 1; 0 1 2]   eigenvalues all positive
    const A = symmetricFromDense([
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ]);
    const b = Float64Array.from([5, 5, 3]);
    const r = solveMinres(A, b, { tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(residualNorm(A, r.x, b)).toBeLessThan(1e-9);
  });

  it('solves a sign-indefinite 3×3 system that CG would diverge on', () => {
    // Symmetric, det = −9 (non-singular), with mixed-sign eigenvalues
    // (trace = 1, det negative ⇒ at least one negative eigenvalue).
    // CG breaks down on the very first negative-curvature direction.
    const A = symmetricFromDense([
      [1, 2, 0],
      [2, -1, 2],
      [0, 2, 1],
    ]);
    const b = Float64Array.from([4, 5, 6]);
    // Exact solution by hand: x = (2/3, 5/3, 8/3).
    const r = solveMinres(A, b, { tol: 1e-12, maxIter: 100 });
    expect(r.converged).toBe(true);
    expect(residualNorm(A, r.x, b)).toBeLessThan(1e-9);
    expect(r.x[0]).toBeCloseTo(2 / 3, 8);
    expect(r.x[1]).toBeCloseTo(5 / 3, 8);
    expect(r.x[2]).toBeCloseTo(8 / 3, 8);
  });

  it('handles a near-singular case with a known sign-indefinite spectrum', () => {
    // diag(3, 2, -0.001, -1, -2): one eigenvalue tiny — the kind of
    // condition we expect when a Helmholtz K - k0^2 M happens to sit
    // close to a cavity cutoff.
    const A = symmetricFromDense([
      [3, 0, 0, 0, 0],
      [0, 2, 0, 0, 0],
      [0, 0, -0.001, 0, 0],
      [0, 0, 0, -1, 0],
      [0, 0, 0, 0, -2],
    ]);
    const b = Float64Array.from([6, 4, 0.0005, 1, 4]);
    const r = solveMinres(A, b, { tol: 1e-10, maxIter: 200 });
    expect(r.converged).toBe(true);
    expect(residualNorm(A, r.x, b)).toBeLessThan(1e-6);
    // Each component should equal b_i / λ_i exactly (diagonal solve).
    expect(r.x[0]!).toBeCloseTo(2, 7);
    expect(r.x[1]!).toBeCloseTo(2, 7);
    expect(r.x[2]!).toBeCloseTo(-0.5, 5); // 0.0005 / -0.001
    expect(r.x[3]!).toBeCloseTo(-1, 7);
    expect(r.x[4]!).toBeCloseTo(-2, 7);
  });

  it('zero RHS returns the zero solution immediately', () => {
    const A = symmetricFromDense([
      [2, 1],
      [1, -1],
    ]);
    const b = new Float64Array(2);
    const r = solveMinres(A, b);
    expect(r.iterations).toBe(0);
    expect(r.x[0]).toBe(0);
    expect(r.x[1]).toBe(0);
  });

  it('respects an initial guess', () => {
    // Solve A x = b but start from an iterate already close to the answer.
    const A = symmetricFromDense([
      [1, 2],
      [2, -3],
    ]);
    // Verify against a hand-computed solution. det(A) = -3 - 4 = -7.
    // Solving Ax = (1, 1):
    //   x1 + 2x2 = 1
    //   2x1 - 3x2 = 1
    //   → x1 = 5/7, x2 = 1/7
    const b = Float64Array.from([1, 1]);
    const guess = Float64Array.from([5 / 7 + 1e-3, 1 / 7 - 1e-3]);
    const r = solveMinres(A, b, { initialGuess: guess, tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(5 / 7, 8);
    expect(r.x[1]).toBeCloseTo(1 / 7, 8);
  });
});
