// @vitest-environment node
/**
 * Complex sparse matrix infrastructure (Round 8c Stage 3a-i).
 *
 * Most of these are hand-computed: small enough matrices and vectors
 * that the expected output can be derived in 30 seconds with a
 * calculator. The two tricky pieces are
 *
 *   - **Bilinear vs sesquilinear inner product**: cdot returns
 *     Σ x_i y_i (no conjugation), cdotH returns Σ x̄_i y_i. Mixing
 *     them is the classic complex-symmetric Krylov bug; we test both
 *     to pin the contract.
 *
 *   - **Transpose vs adjoint matvec**: cspmvT returns Aᵀ·x with no
 *     conjugation of A's entries. For complex symmetric A this equals
 *     A·x; for general A it differs from the Hermitian adjoint. The
 *     dense cross-check uses an asymmetric A to keep the two cases
 *     visibly distinct.
 */

import { describe, expect, it } from 'vitest';
import {
  caxpy,
  cdot,
  cdotH,
  cnorm2,
  ComplexCooBuilder,
  cscale,
  cspmv,
  cspmvT,
  realToComplexCsr,
} from '../../src/fem-fullwave/complex-sparse';
import { CooBuilder } from '../../../src/fem/sparse';

/** Build a complex vector from an array of [re, im] pairs. */
function vec(pairs: Array<[number, number]>): Float64Array {
  const v = new Float64Array(2 * pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    v[2 * i] = pairs[i]![0];
    v[2 * i + 1] = pairs[i]![1];
  }
  return v;
}

describe('ComplexCooBuilder.toCsr', () => {
  it('compacts triplets, sums duplicates, sorts columns within each row', () => {
    // [[1+j, 0,   2−j],
    //  [0,   3,   0  ],
    //  [4j,  0,   1+0j]]
    const b = new ComplexCooBuilder(3);
    b.add(0, 0, 0.5, 0.5); // half of (1+j) — duplicate
    b.add(0, 0, 0.5, 0.5); // the other half — should sum to (1+j)
    b.add(0, 2, 2, -1);
    b.add(1, 1, 3, 0);
    b.add(2, 0, 0, 4);
    b.add(2, 2, 1, 0);
    const A = b.toCsr();
    expect(A.numRows).toBe(3);
    expect(A.numCols).toBe(3);
    expect(Array.from(A.rowPtr)).toEqual([0, 2, 3, 5]);
    expect(Array.from(A.colIdx)).toEqual([0, 2, 1, 0, 2]);
    // values: row 0 col 0 → 1+j; row 0 col 2 → 2−j; row 1 col 1 → 3+0j;
    //         row 2 col 0 → 0+4j; row 2 col 2 → 1+0j
    expect(Array.from(A.values)).toEqual([1, 1, 2, -1, 3, 0, 0, 4, 1, 0]);
  });
});

describe('cspmv — complex matrix-vector product', () => {
  it('matches a hand-computed product on a 2×2 example', () => {
    // A = [[1+j, 2−j], [0, 3+0j]], x = [1+0j, 0+1j]
    // y = A x = [(1+j)·1 + (2−j)·j, 0 + (3+0j)·j] = [1 + j + 2j + 1, 3j]
    //        = [2 + 3j, 0 + 3j]
    const b = new ComplexCooBuilder(2);
    b.add(0, 0, 1, 1);
    b.add(0, 1, 2, -1);
    b.add(1, 1, 3, 0);
    const A = b.toCsr();
    const x = vec([
      [1, 0],
      [0, 1],
    ]);
    const y = cspmv(A, x);
    expect(Array.from(y)).toEqual([2, 3, 0, 3]);
  });

  it('rectangular matrix matvec respects shape', () => {
    // 3×2 complex matrix.
    const b = new ComplexCooBuilder(3, 2);
    b.add(0, 0, 1, 0);
    b.add(1, 0, 0, 1);
    b.add(1, 1, 1, 0);
    b.add(2, 1, 0, -1);
    const A = b.toCsr();
    expect(A.numRows).toBe(3);
    expect(A.numCols).toBe(2);
    const x = vec([
      [1, 1],
      [2, 0],
    ]); // (1+j, 2)
    const y = cspmv(A, x);
    // row 0: (1+0j)(1+j) = 1 + j
    // row 1: (j)(1+j) + (1)(2) = j + j² + 2 = 2 − 1 + j = 1 + j
    // row 2: (−j)(2) = 0 − 2j
    expect(Array.from(y)).toEqual([1, 1, 1, 1, 0, -2]);
  });
});

describe('cspmvT — true transpose (no conjugation)', () => {
  it('agrees with a dense Aᵀ·x on a small asymmetric example', () => {
    // Use an asymmetric A so the test would also catch a bug if cspmvT
    // accidentally implemented the Hermitian adjoint.
    const b = new ComplexCooBuilder(2, 3);
    b.add(0, 0, 1, 1); // 1 + j
    b.add(0, 1, 2, 0); // 2
    b.add(0, 2, 0, 3); // 3j
    b.add(1, 0, 4, 0); // 4
    b.add(1, 2, 1, -1); // 1 − j
    const A = b.toCsr();
    const x = vec([
      [2, 0],
      [0, 1],
    ]); // (2, j)
    // Aᵀ x:
    //   row 0: (1+j)(2) + (4)(j) = 2 + 2j + 4j = 2 + 6j
    //   row 1: (2)(2) + 0(j)     = 4
    //   row 2: (3j)(2) + (1−j)(j) = 6j + j + 1 = 1 + 7j
    const y = cspmvT(A, x);
    expect(Array.from(y)).toEqual([2, 6, 4, 0, 1, 7]);
  });
});

describe('cdot — bilinear inner product (Σ x_i y_i, no conjugation)', () => {
  it('matches the closed-form on a 2-vector', () => {
    // x = (1+j, 2),  y = (3, 1−j)
    // cdot = (1+j)(3) + (2)(1−j) = 3 + 3j + 2 − 2j = 5 + j
    const x = vec([
      [1, 1],
      [2, 0],
    ]);
    const y = vec([
      [3, 0],
      [1, -1],
    ]);
    expect(cdot(x, y)).toEqual({ re: 5, im: 1 });
  });

  it('cdot(x, x) is generally not real for complex x', () => {
    // x = (1+j, 2j) → cdot(x, x) = (1+j)² + (2j)² = (1 + 2j − 1) + (−4) = −4 + 2j
    const x = vec([
      [1, 1],
      [0, 2],
    ]);
    expect(cdot(x, x)).toEqual({ re: -4, im: 2 });
  });
});

describe('cdotH — sesquilinear (Hermitian) inner product (Σ x̄_i y_i)', () => {
  it('matches the closed-form on a 2-vector', () => {
    // x = (1+j, 2),  y = (3, 1−j)
    // cdotH = conj(1+j)(3) + (2)(1−j) = (1−j)(3) + 2(1−j) = 3 − 3j + 2 − 2j = 5 − 5j
    const x = vec([
      [1, 1],
      [2, 0],
    ]);
    const y = vec([
      [3, 0],
      [1, -1],
    ]);
    expect(cdotH(x, y)).toEqual({ re: 5, im: -5 });
  });

  it('cdotH(x, x) is real and non-negative (the 2-norm squared)', () => {
    // x = (1+j, 2j) → ‖x‖² = |1+j|² + |2j|² = 2 + 4 = 6
    const x = vec([
      [1, 1],
      [0, 2],
    ]);
    const inner = cdotH(x, x);
    expect(inner.re).toBe(6);
    expect(inner.im).toBe(0);
    expect(cnorm2(x)).toBeCloseTo(Math.sqrt(6), 12);
  });
});

describe('caxpy / cscale — complex BLAS-1 ops', () => {
  it('caxpy: y ← y + α x with complex α', () => {
    const x = vec([
      [1, 0],
      [0, 1],
    ]); // (1, j)
    const y = vec([
      [1, 1],
      [2, 0],
    ]); // (1+j, 2)
    // α = (0, 2) = 2j
    // 2j · x = (2j, 2j² ) = (2j, −2)
    // y + 2j x = (1 + j + 2j, 2 − 2) = (1 + 3j, 0)
    caxpy(0, 2, x, y);
    expect(Array.from(y)).toEqual([1, 3, 0, 0]);
  });

  it('cscale: y ← α x produces a fresh array', () => {
    const x = vec([
      [1, 1],
      [0, 1],
    ]); // (1+j, j)
    // α = 1 − j
    // (1−j)(1+j) = 1 + j − j − j² = 2
    // (1−j)(j)   = j − j² = j + 1
    const y = cscale(1, -1, x);
    expect(Array.from(y)).toEqual([2, 0, 1, 1]);
    // Original untouched.
    expect(Array.from(x)).toEqual([1, 1, 0, 1]);
  });
});

describe('realToComplexCsr — real → complex promotion', () => {
  it('zero-fills the imaginary part and preserves matvec', () => {
    const b = new CooBuilder(2);
    b.add(0, 0, 2);
    b.add(0, 1, 1);
    b.add(1, 1, 3);
    const Areal = b.toCsr();
    const Acomplex = realToComplexCsr(Areal);
    expect(Acomplex.numRows).toBe(2);
    expect(Acomplex.numCols).toBe(2);
    expect(Acomplex.values.length).toBe(2 * Areal.values.length);
    // Imag parts all zero.
    for (let k = 0; k < Areal.values.length; k++) {
      expect(Acomplex.values[2 * k + 1]).toBe(0);
    }
    // Matvec result equals the real one when x is real.
    const x = vec([
      [1, 0],
      [2, 0],
    ]);
    const y = cspmv(Acomplex, x);
    // Real A x with x = (1, 2) → (4, 6)
    expect(y[0]).toBe(4);
    expect(y[1]).toBe(0);
    expect(y[2]).toBe(6);
    expect(y[3]).toBe(0);
  });
});
