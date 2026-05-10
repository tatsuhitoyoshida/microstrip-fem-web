// @vitest-environment node
/**
 * Complex Bi-CGSTAB linear solver (Round 8c Stage 3a-ii).
 *
 * Three layers of validation:
 *
 *   1. **Real-valued sanity** — feed a real SPD system through the
 *      complex solver (im = 0) and check it reproduces the answer
 *      we'd get from `solveCgJacobi`. Catches plumbing bugs (BLAS
 *      conventions, transposed indexing, etc.) without complex
 *      arithmetic getting in the way.
 *
 *   2. **Complex symmetric well-conditioned** — a hand-built 2×2
 *      with closed-form solution. Pins the complex multiply / divide
 *      paths and the Hermitian residual norm.
 *
 *   3. **Complex non-symmetric** — proves BiCGStab isn't relying on
 *      symmetry. Uses a small non-Hermitian operator with a known
 *      solution.
 *
 *   4. **Indefinite shift-invert proxy** — a complex symmetric
 *      indefinite matrix (eigenvalues straddling zero) that mimics
 *      the shifted operator we'll see in the PML eigsolver. Ensures
 *      BiCGStab degrades gracefully where COCG would break down.
 */

import { describe, expect, it } from 'vitest';
import {
  ComplexCooBuilder,
  cnorm2,
  cspmv,
} from '../../src/fem-fullwave/complex-sparse';
import { solveCBicgstab } from '../../src/fem-fullwave/complex-solver';

/** Build a complex vector from an array of [re, im] pairs. */
function vec(pairs: Array<[number, number]>): Float64Array {
  const v = new Float64Array(2 * pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    v[2 * i] = pairs[i]![0];
    v[2 * i + 1] = pairs[i]![1];
  }
  return v;
}

/** Compute ‖A x − b‖ in Hermitian 2-norm. */
function residualNorm(
  A: Parameters<typeof cspmv>[0],
  x: Float64Array,
  b: Float64Array,
): number {
  const Ax = cspmv(A, x);
  const r = new Float64Array(b);
  for (let i = 0; i < b.length; i++) r[i] = r[i]! - Ax[i]!;
  return cnorm2(r);
}

describe('solveCBicgstab — complex Bi-CGSTAB', () => {
  it('handles a real SPD system through the complex storage path', () => {
    // [[4, 1, 0], [1, 3, 1], [0, 1, 2]] — same as `tests/sparse.test.ts`
    // hand-checks but lifted into complex storage with im = 0.
    const builder = new ComplexCooBuilder(3);
    builder.add(0, 0, 4, 0);
    builder.add(0, 1, 1, 0);
    builder.add(1, 0, 1, 0);
    builder.add(1, 1, 3, 0);
    builder.add(1, 2, 1, 0);
    builder.add(2, 1, 1, 0);
    builder.add(2, 2, 2, 0);
    const A = builder.toCsr();
    const b = vec([
      [5, 0],
      [5, 0],
      [3, 0],
    ]);
    const r = solveCBicgstab(A, b, { tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(residualNorm(A, r.x, b)).toBeLessThan(1e-9);
    // Imaginary parts should be FP zero.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(r.x[2 * i + 1]!)).toBeLessThan(1e-12);
    }
  });

  it('solves a 2×2 complex symmetric system with a known closed-form answer', () => {
    // A = [[2, 1+j], [1+j, 3]], b = (1, j).
    // Hand-derived: det A = 6 − (1+j)² = 6 − 2j; A⁻¹ = (1/(6−2j)) · [[3, −(1+j)], [−(1+j), 2]];
    // x₁ = 0.65 + 0.05j, x₂ = −0.2 + 0.1j.
    const builder = new ComplexCooBuilder(2);
    builder.add(0, 0, 2, 0);
    builder.add(0, 1, 1, 1);
    builder.add(1, 0, 1, 1);
    builder.add(1, 1, 3, 0);
    const A = builder.toCsr();
    const b = vec([
      [1, 0],
      [0, 1],
    ]);
    const r = solveCBicgstab(A, b, { tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(0.65, 9);
    expect(r.x[1]).toBeCloseTo(0.05, 9);
    expect(r.x[2]).toBeCloseTo(-0.2, 9);
    expect(r.x[3]).toBeCloseTo(0.1, 9);
    expect(residualNorm(A, r.x, b)).toBeLessThan(1e-9);
  });

  it('solves a non-symmetric complex system', () => {
    // A = [[1+j, 2], [j, 3−j]], non-Hermitian and non-symmetric.
    // Hand check: det = (1+j)(3−j) − 2j = (3 − j + 3j − j²) − 2j = 4 + 2j − 2j = 4.
    // A⁻¹ = (1/4) · [[3−j, −2], [−j, 1+j]].
    // Take b = (4, 0). Then x = A⁻¹ b = (1/4)(4(3−j), −4j) = (3 − j, −j).
    const builder = new ComplexCooBuilder(2);
    builder.add(0, 0, 1, 1);
    builder.add(0, 1, 2, 0);
    builder.add(1, 0, 0, 1);
    builder.add(1, 1, 3, -1);
    const A = builder.toCsr();
    const b = vec([
      [4, 0],
      [0, 0],
    ]);
    const r = solveCBicgstab(A, b, { tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(3, 9);
    expect(r.x[1]).toBeCloseTo(-1, 9);
    expect(r.x[2]).toBeCloseTo(0, 9);
    expect(r.x[3]).toBeCloseTo(-1, 9);
  });

  it('handles a complex symmetric indefinite system (shift-invert proxy)', () => {
    // diag(1, −2, 0.5j) — three eigenvalues straddling the origin, with
    // one purely imaginary. Looks like a shift-invert (A − σM) operator.
    // Solving with b = (1, 1, 1) gives x = (1, −0.5, 1/(0.5j)) = (1, −0.5, −2j).
    const builder = new ComplexCooBuilder(3);
    builder.add(0, 0, 1, 0);
    builder.add(1, 1, -2, 0);
    builder.add(2, 2, 0, 0.5);
    const A = builder.toCsr();
    const b = vec([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const r = solveCBicgstab(A, b, { tol: 1e-11, maxIter: 100 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(1, 9);
    expect(r.x[1]).toBeCloseTo(0, 9);
    expect(r.x[2]).toBeCloseTo(-0.5, 9);
    expect(r.x[3]).toBeCloseTo(0, 9);
    expect(r.x[4]).toBeCloseTo(0, 9);
    expect(r.x[5]).toBeCloseTo(-2, 9);
  });

  it('respects an initial guess', () => {
    // A = diag(2, 4), b = (4, 8). Trivial answer x = (2, 2). Start
    // close to that and verify few-iteration convergence + correctness.
    const builder = new ComplexCooBuilder(2);
    builder.add(0, 0, 2, 0);
    builder.add(1, 1, 4, 0);
    const A = builder.toCsr();
    const b = vec([
      [4, 0],
      [8, 0],
    ]);
    const guess = vec([
      [2 + 1e-3, 0],
      [2 - 1e-3, 0],
    ]);
    const r = solveCBicgstab(A, b, { initialGuess: guess, tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(2, 9);
    expect(r.x[2]).toBeCloseTo(2, 9);
  });

  it('zero RHS returns the zero solution immediately', () => {
    const builder = new ComplexCooBuilder(2);
    builder.add(0, 0, 1, 1);
    builder.add(1, 1, 1, -1);
    const A = builder.toCsr();
    const b = new Float64Array(4);
    const r = solveCBicgstab(A, b);
    expect(r.iterations).toBe(0);
    expect(r.x[0]).toBe(0);
    expect(r.x[1]).toBe(0);
  });
});
