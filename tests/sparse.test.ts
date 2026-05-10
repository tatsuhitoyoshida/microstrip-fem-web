import { describe, expect, it } from 'vitest';
import {
  addToDiagonal,
  axpy,
  cloneCsr,
  CooBuilder,
  diagonal,
  dot,
  spmv,
  xpay,
} from '../src/fem/sparse';

describe('CooBuilder.toCsr', () => {
  it('compacts triplets, sums duplicates, sorts columns within each row', () => {
    const b = new CooBuilder(3);
    // [[2, 0, 1],
    //  [1, 3, 0],
    //  [0, 0, 4]]
    b.add(0, 0, 1);
    b.add(0, 0, 1); // duplicate, should sum to 2
    b.add(0, 2, 1);
    b.add(1, 1, 3);
    b.add(1, 0, 1);
    b.add(2, 2, 4);
    const A = b.toCsr();
    expect(A.numRows).toBe(3);
    expect(A.numCols).toBe(3);
    expect(Array.from(A.rowPtr)).toEqual([0, 2, 4, 5]);
    expect(Array.from(A.colIdx)).toEqual([0, 2, 0, 1, 2]);
    expect(Array.from(A.values)).toEqual([2, 1, 1, 3, 4]);
  });
});

describe('spmv', () => {
  it('matches a hand-computed product on a 3×3 example', () => {
    const b = new CooBuilder(3);
    b.add(0, 0, 2);
    b.add(0, 2, 1);
    b.add(1, 0, 1);
    b.add(1, 1, 3);
    b.add(2, 2, 4);
    const A = b.toCsr();
    const x = Float64Array.from([1, 2, 3]);
    const y = spmv(A, x);
    // [[2,0,1],[1,3,0],[0,0,4]] * [1,2,3] = [5, 7, 12]
    expect(Array.from(y)).toEqual([5, 7, 12]);
  });
});

describe('diagonal / addToDiagonal', () => {
  it('extracts the diagonal and additively patches it', () => {
    const b = new CooBuilder(3);
    b.add(0, 0, 1);
    b.add(1, 1, 2);
    b.add(2, 2, 3);
    b.add(0, 1, 5); // off-diagonal, should not appear in diag
    const A = b.toCsr();
    expect(Array.from(diagonal(A))).toEqual([1, 2, 3]);
    addToDiagonal(A, [0, 2], 10);
    expect(Array.from(diagonal(A))).toEqual([11, 2, 13]);
  });
});

describe('vector helpers', () => {
  it('dot, axpy, xpay agree with their definitions', () => {
    const x = Float64Array.from([1, 2, 3]);
    const y = Float64Array.from([4, 5, 6]);
    expect(dot(x, y)).toBe(1 * 4 + 2 * 5 + 3 * 6);

    const y1 = new Float64Array(y);
    axpy(2, x, y1); // y ← y + 2 x
    expect(Array.from(y1)).toEqual([6, 9, 12]);

    const y2 = Float64Array.from([1, 1, 1]);
    xpay(2, x, y2); // y ← x + 2 y
    expect(Array.from(y2)).toEqual([3, 4, 5]);
  });
});

describe('cloneCsr', () => {
  it('produces an independent copy', () => {
    const b = new CooBuilder(2);
    b.add(0, 0, 1);
    b.add(1, 1, 2);
    const A = b.toCsr();
    const C = cloneCsr(A);
    addToDiagonal(C, [0], 99);
    expect(diagonal(A)[0]).toBe(1);
    expect(diagonal(C)[0]).toBe(100);
  });
});
