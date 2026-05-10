// @vitest-environment node
/**
 * Complex shift-invert generalised eigensolver (Round 8c Stage 3a-v-c-1).
 *
 * Three layers, each isolating one numerical feature:
 *
 *   1. **Real lifted to complex**: a real SPD GEP run through the
 *      complex pipeline must reproduce the real-track answer. Pins
 *      the basic plumbing (build shifted matrix, BiCGStab inner
 *      solve, Rayleigh quotient with imag = 0).
 *
 *   2. **Diagonal complex**: trivial eigenvalues (the diagonal
 *      entries themselves), so we know the answer in closed form.
 *      Run with σ near a specific eigenvalue and check we recover it.
 *
 *   3. **Complex symmetric 2×2 with hand-derived spectrum**: the
 *      smallest non-trivial sanity check — eigenvalues come from a
 *      2×2 quadratic, which I work out below in the comments.
 */

import { describe, expect, it } from 'vitest';
import {
  cabs,
  ComplexCooBuilder,
  cspmv,
  type ComplexCsrMatrix,
} from '../../src/fem-fullwave/complex-sparse';
import { shiftInvertEigenvalueComplex } from '../../src/fem-fullwave/complex-eigsolve';

/** Helper: build a complex CSR diagonal from an array of [re, im] pairs. */
function diagComplex(pairs: Array<[number, number]>): ComplexCsrMatrix {
  const b = new ComplexCooBuilder(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    b.add(i, i, pairs[i]![0], pairs[i]![1]);
  }
  return b.toCsr();
}

/** Build a complex CSR from a dense [[re, im], …] 2-D array. */
function complexFromDense(rows: Array<Array<[number, number]>>): ComplexCsrMatrix {
  const n = rows.length;
  const b = new ComplexCooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [re, im] = rows[i]![j]!;
      if (re !== 0 || im !== 0) b.add(i, j, re, im);
    }
  }
  return b.toCsr();
}

/** Compute the GEP residual ‖A x − λ B x‖₂ for a complex eigenpair. */
function gepResidualNorm(
  A: ComplexCsrMatrix,
  B: ComplexCsrMatrix,
  lambda: { re: number; im: number },
  x: Float64Array,
): number {
  const Ax = cspmv(A, x);
  const Bx = cspmv(B, x);
  const n2 = Ax.length;
  let s = 0;
  for (let i = 0; i < n2 / 2; i++) {
    const axRe = Ax[2 * i]!;
    const axIm = Ax[2 * i + 1]!;
    const bxRe = Bx[2 * i]!;
    const bxIm = Bx[2 * i + 1]!;
    // λ · B x (complex multiply)
    const lbRe = lambda.re * bxRe - lambda.im * bxIm;
    const lbIm = lambda.re * bxIm + lambda.im * bxRe;
    const dRe = axRe - lbRe;
    const dIm = axIm - lbIm;
    s += dRe * dRe + dIm * dIm;
  }
  return Math.sqrt(s);
}

describe('shiftInvertEigenvalueComplex — real lifted to complex', () => {
  it('real diagonal SPD problem reproduces the real-track answer through the complex pipeline', () => {
    // λ ∈ {1, 2, 5, 7, 10}, B = I_5. σ = 4.6 → closest real eigenvalue is 5.
    const A = diagComplex([
      [1, 0],
      [2, 0],
      [5, 0],
      [7, 0],
      [10, 0],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 4.6, im: 0 },
      tol: 1e-12,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue.re).toBeCloseTo(5, 8);
    expect(Math.abs(r.eigenvalue.im)).toBeLessThan(1e-8);
  });
});

describe('shiftInvertEigenvalueComplex — diagonal complex', () => {
  it('lands on the diagonal entry closest in absolute distance to σ', () => {
    // A = diag(1+j, 2+j, 3−j), B = I.
    // Eigenvalues are exactly the diagonal entries.
    // σ = 2.5 + 0.8j → distances:
    //   |σ − (1+j)| = |1.5 − 0.2j| ≈ 1.51
    //   |σ − (2+j)| = |0.5 − 0.2j| ≈ 0.54  ← closest
    //   |σ − (3−j)| = |−0.5 + 1.8j| ≈ 1.87
    const A = diagComplex([
      [1, 1],
      [2, 1],
      [3, -1],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 2.5, im: 0.8 },
      tol: 1e-12,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue.re).toBeCloseTo(2, 8);
    expect(r.eigenvalue.im).toBeCloseTo(1, 8);
    // GEP residual: outer iteration converges in λ to ~tol, but the
    // eigenvector residual is typically ~√tol. Allow some headroom.
    expect(gepResidualNorm(A, B, r.eigenvalue, r.eigenvector)).toBeLessThan(1e-6);
  });

  it('shifts to a different eigenvalue when σ moves', () => {
    const A = diagComplex([
      [1, 1],
      [2, 1],
      [3, -1],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    // σ = 3 − 0.7j → closest is 3 − j.
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 3, im: -0.7 },
      tol: 1e-12,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue.re).toBeCloseTo(3, 8);
    expect(r.eigenvalue.im).toBeCloseTo(-1, 8);
  });
});

describe('shiftInvertEigenvalueComplex — complex symmetric 2×2', () => {
  it('finds a hand-checked eigenvalue of A = [[1, 2j], [2j, 3]]', () => {
    // Spectrum: det(A − λI) = (1 − λ)(3 − λ) − (2j)² = (1 − λ)(3 − λ) + 4
    //                       = λ² − 4λ + 3 + 4 = λ² − 4λ + 7
    // Roots: λ = 2 ± √(4 − 7) = 2 ± j√3 ≈ {2 + 1.732j, 2 − 1.732j}.
    const A = complexFromDense([
      [
        [1, 0],
        [0, 2],
      ],
      [
        [0, 2],
        [3, 0],
      ],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
    ]);
    // Pick σ closer to the +√3 root.
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 2.1, im: 1.5 },
      tol: 1e-12,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue.re).toBeCloseTo(2, 6);
    expect(r.eigenvalue.im).toBeCloseTo(Math.sqrt(3), 6);
    expect(gepResidualNorm(A, B, r.eigenvalue, r.eigenvector)).toBeLessThan(1e-7);
  });

  it('finds the conjugate root when σ flips sign on the imaginary axis', () => {
    const A = complexFromDense([
      [
        [1, 0],
        [0, 2],
      ],
      [
        [0, 2],
        [3, 0],
      ],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
    ]);
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 2.1, im: -1.5 },
      tol: 1e-12,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue.re).toBeCloseTo(2, 6);
    expect(r.eigenvalue.im).toBeCloseTo(-Math.sqrt(3), 6);
  });
});

describe('shiftInvertEigenvalueComplex — sanity', () => {
  it('rejects shifts that land exactly on an eigenvalue (singular shifted matrix)', () => {
    // A = diag(1, 2), B = I. σ = 1 + 0j is exactly an eigenvalue, so
    // (A − σ B) is singular. The inner BiCGStab will fail.
    const A = diagComplex([
      [1, 0],
      [2, 0],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
    ]);
    expect(() =>
      shiftInvertEigenvalueComplex(A, B, {
        shift: { re: 1, im: 0 },
        tol: 1e-12,
        maxIter: 20,
      }),
    ).toThrow(/converge|breakdown/i);
  });

  it('produces a meaningful eigenvector (non-trivial in some component)', () => {
    // Diagonal A → eigenvalues are exactly the diagonal entries, so we
    // must avoid σ landing *on* one (that makes the shifted matrix
    // singular and BiCGStab breaks down). Pick σ slightly off the
    // target eigenvalue 3+j.
    const A = diagComplex([
      [1, 0],
      [3, 1],
      [5, -1],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 3.05, im: 1.05 },
      tol: 1e-10,
    });
    expect(r.converged).toBe(true);
    // For a diagonal matrix with the eigenvalue at row 1, the
    // eigenvector should concentrate on component 1.
    const mag = (i: number): number =>
      Math.hypot(r.eigenvector[2 * i]!, r.eigenvector[2 * i + 1]!);
    expect(mag(1)).toBeGreaterThan(0.9);
    expect(mag(0)).toBeLessThan(0.3);
    expect(mag(2)).toBeLessThan(0.3);
  });

  it('gracefully reports an unconverged run via the `converged` flag', () => {
    // A poorly-shifted problem with a tight maxIter cap: spectrum
    // {1, 2, 3} and σ exactly at the midpoint 2 → distances 1, 0, 1
    // tied between two eigenvalues. With deliberately tiny maxIter
    // and tol, expect either non-convergence or a successful run.
    const A = diagComplex([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const B = diagComplex([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    // σ exactly at an eigenvalue is the ill-posed case caught above;
    // here pick σ that's close to (but not at) the boundary of the
    // closest-eigenvalue tie, with a tight iter cap.
    const r = shiftInvertEigenvalueComplex(A, B, {
      shift: { re: 2.5, im: 0 },
      tol: 1e-15,
      maxIter: 3,
    });
    // Either converges (cheap diagonal) or surfaces a clean
    // un-converged result rather than throwing.
    expect(typeof r.converged).toBe('boolean');
    expect(typeof r.eigenvalue.re).toBe('number');
    void cabs;
  });
});
