import { describe, expect, it } from 'vitest';
import { CooBuilder, type CsrMatrix } from '../src/fem/sparse';
import { solveCgJacobi } from '../src/fem/solver';

/** Build a CSR matrix from a dense symmetric array (skipping zeros). */
function csrFromDense(dense: number[][]): CsrMatrix {
  const n = dense.length;
  const b = new CooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = dense[i]![j]!;
      if (v !== 0) b.add(i, j, v);
    }
  }
  return b.toCsr();
}

describe('CG with Jacobi preconditioner', () => {
  it('solves a 2×2 SPD system to machine precision', () => {
    // [[2, -1], [-1, 2]] x = [1, 1]  ⇒  x = [1, 1]
    const K = csrFromDense([
      [2, -1],
      [-1, 2],
    ]);
    const b = Float64Array.from([1, 1]);
    const { x, converged, iterations, relResidual } = solveCgJacobi(K, b);
    expect(converged).toBe(true);
    expect(iterations).toBeGreaterThan(0);
    expect(relResidual).toBeLessThan(1e-10);
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(1, 12);
  });

  it('solves a 5×5 1-D Laplacian against a known x', () => {
    // K is the 1-D finite-difference Laplacian: tridiag(-1, 2, -1)
    // Choose a known x = [1, 2, 3, 4, 5], compute b = K x, recover x.
    const dense = [
      [2, -1, 0, 0, 0],
      [-1, 2, -1, 0, 0],
      [0, -1, 2, -1, 0],
      [0, 0, -1, 2, -1],
      [0, 0, 0, -1, 2],
    ];
    const K = csrFromDense(dense);
    const xExact = [1, 2, 3, 4, 5];
    const b = new Float64Array(5);
    for (let i = 0; i < 5; i++) {
      let s = 0;
      for (let j = 0; j < 5; j++) s += dense[i]![j]! * xExact[j]!;
      b[i] = s;
    }
    const { x, converged } = solveCgJacobi(K, b);
    expect(converged).toBe(true);
    for (let i = 0; i < 5; i++) expect(x[i]).toBeCloseTo(xExact[i]!, 10);
  });

  it('returns x = 0 immediately for b = 0', () => {
    const K = csrFromDense([
      [3, 1],
      [1, 3],
    ]);
    const { x, iterations, converged } = solveCgJacobi(K, new Float64Array([0, 0]));
    expect(converged).toBe(true);
    expect(iterations).toBe(0);
    expect(Array.from(x)).toEqual([0, 0]);
  });

  it('detects a non-SPD matrix via zero diagonal', () => {
    const b = new CooBuilder(2);
    b.add(0, 0, 1);
    b.add(1, 0, 1);
    b.add(0, 1, 1);
    const K = b.toCsr();
    expect(() => solveCgJacobi(K, new Float64Array([1, 1]))).toThrow();
  });
});
