// @vitest-environment node
/**
 * Shift-invert eigenvalue solver with MINRES + gradient deflation
 * (Vector Stage 2.3c).
 *
 * Three layers of test, increasing in nastiness:
 *
 *   1. **SPD synthetic**: A and B both SPD, isolated eigenvalues. The
 *      shift-invert mechanics (Rayleigh-quotient update, B-normalisation,
 *      shift-back λ = σ + 1/μ) are independent of indefiniteness, so a
 *      diagonal toy problem proves the algorithm is wired up right.
 *
 *   2. **Sign-indefinite synthetic**: A has mixed-sign eigenvalues.
 *      MINRES is mandatory (CG would diverge), and we still need to
 *      land on the eigenvalue closest to σ.
 *
 *   3. **Curl-curl with deflation**: K_curl on a small structured mesh
 *      is rank-deficient — its null space is the gradient subspace
 *      (numNodes − 1 dimensions). Without the deflator, shift-invert
 *      with a small σ would lock onto a spurious zero eigenvalue
 *      (because T_σ has a huge eigenvalue −1/σ in V_grad). With the
 *      deflator the iteration is restricted to V_perp and finds a
 *      genuinely positive eigenvalue.
 */

import { describe, expect, it } from 'vitest';
import { CooBuilder, type CsrMatrix, dot, spmv } from '../../../src/fem/sparse';
import { shiftInvertEigenvalue } from '../../src/fem-fullwave/eigsolve';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
} from '../../src/fem-fullwave/vector-assembly';
import {
  assembleDiscreteGradient,
  buildGradientDeflator,
} from '../../src/fem-fullwave/gradient';
import type { Mesh } from '../../../src/types';

/** Diagonal matrix from a list of values. */
function diag(values: number[]): CsrMatrix {
  const n = values.length;
  const builder = new CooBuilder(n);
  for (let i = 0; i < n; i++) builder.add(i, i, values[i]!);
  return builder.toCsr();
}

/** Symmetric CSR from a 2-D number array. */
function symmetricFromDense(rows: number[][]): CsrMatrix {
  const n = rows.length;
  const builder = new CooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = rows[i]![j]!;
      if (v !== 0) builder.add(i, j, v);
    }
  }
  return builder.toCsr();
}

/** Same 4×3 structured rectangular mesh used by gradient.test.ts. */
function rectangularMesh(nx: number, ny: number, lx: number, ly: number): Mesh {
  const numNodes = nx * ny;
  const verts = new Float64Array(2 * numNodes);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      verts[2 * n] = (i * lx) / (nx - 1);
      verts[2 * n + 1] = (j * ly) / (ny - 1);
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = j * nx + i + 1;
      const c = (j + 1) * nx + i;
      const d = (j + 1) * nx + i + 1;
      tris.push(a, b, d);
      tris.push(a, d, c);
    }
  }
  return {
    vertices: verts,
    triangles: Int32Array.from(tris),
    triangleAttributes: new Float64Array(tris.length / 3),
    vertexMarkers: new Int32Array(numNodes),
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: tris.length / 3,
  };
}

describe('Shift-invert eigensolver — SPD synthetic', () => {
  it('finds the SPD eigenvalue closest to σ on a diagonal problem', () => {
    // λ ∈ {1, 2, 5, 7, 10}. σ = 4.6 → closest is λ = 5.
    const A = diag([1, 2, 5, 7, 10]);
    const B = diag([1, 1, 1, 1, 1]);
    const r = shiftInvertEigenvalue(A, B, { shift: 4.6, tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeCloseTo(5, 8);
  });

  it('lands on a different eigenvalue when σ moves', () => {
    const A = diag([1, 2, 5, 7, 10]);
    const B = diag([1, 1, 1, 1, 1]);
    // σ = 8.5 → closest is λ = 7 (|μ| = 2/3) vs λ = 10 (|μ| = 2/3).
    // Tie — use a lopsided σ that clearly favours one side.
    const r = shiftInvertEigenvalue(A, B, { shift: 7.4, tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeCloseTo(7, 8);
  });

  it('handles a generalised problem with non-trivial B', () => {
    // A = diag(2, 4, 6),  B = diag(1, 2, 3)  →  λ = A_ii / B_ii = {2, 2, 2}
    // (degenerate). Pick A and B with isolated generalised eigenvalues.
    const A = diag([2, 6, 12]);
    const B = diag([1, 2, 3]);
    // λ = {2, 3, 4}. σ = 2.7 → closest is λ = 3.
    const r = shiftInvertEigenvalue(A, B, { shift: 2.7, tol: 1e-12 });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeCloseTo(3, 8);
  });
});

describe('Shift-invert eigensolver — sign-indefinite', () => {
  it('finds an eigenvalue near σ for a 3×3 symmetric indefinite system', () => {
    // A symmetric indefinite. The characteristic polynomial factors as
    //   det(A − λI) = (1 − λ)(λ² − 9) = (1 − λ)(λ − 3)(λ + 3),
    // so the eigenvalues are exactly {−3, 1, 3}.
    // σ = 0.7 → closest is λ = 1.
    const A = symmetricFromDense([
      [1, 2, 0],
      [2, -1, 2],
      [0, 2, 1],
    ]);
    const B = diag([1, 1, 1]);
    const r = shiftInvertEigenvalue(A, B, {
      shift: 0.7,
      tol: 1e-11,
      maxIter: 50,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeCloseTo(1.0, 6);
    // Verify (A − λ I) v ≈ 0 directly.
    const Av = spmv(A, r.eigenvector);
    let resNormSq = 0;
    for (let i = 0; i < 3; i++) {
      const ri = Av[i]! - r.eigenvalue * r.eigenvector[i]!;
      resNormSq += ri * ri;
    }
    expect(Math.sqrt(resNormSq)).toBeLessThan(1e-6);
  });

  it('finds a negative eigenvalue when σ < 0', () => {
    const A = symmetricFromDense([
      [1, 2, 0],
      [2, -1, 2],
      [0, 2, 1],
    ]);
    const B = diag([1, 1, 1]);
    // Spectrum {−3, 1, 3}; σ = −2.5 → closest is λ = −3.
    const r = shiftInvertEigenvalue(A, B, { shift: -2.5, tol: 1e-11 });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeCloseTo(-3.0, 6);
  });
});

describe('Shift-invert eigensolver — curl-curl with deflation', () => {
  it('without deflation, shift-invert near σ=0.05 locks onto a spurious zero', () => {
    // The curl-curl operator is rank-deficient by design: the entire
    // gradient subspace (dim = numNodes − 1) is in its null space.
    // T_σ = (K − σ M)⁻¹ M for σ → 0 has eigenvalue −1/σ on V_grad,
    // which dominates the iteration. The dominant subspace is
    // *degenerate* (every gradient mode shares μ = −1/σ), so the outer
    // |Δλ| convergence flag may never trip — but the eigenvalue must
    // sit right at the spurious 0.
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const K = assembleEdgeCurlCurl(mesh, topo, () => 1);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const r = shiftInvertEigenvalue(K, M, {
      shift: 0.05,
      tol: 1e-6,
      maxIter: 80,
    });
    // |λ| ≪ the smallest physical eigenvalue (which is O(1) on this mesh)
    // — i.e. shift-invert pulled in the spurious zero, exactly the
    // failure mode the deflator is meant to dodge.
    expect(Math.abs(r.eigenvalue)).toBeLessThan(0.1);
  });

  it('with deflation, shift-invert near σ=0.05 returns a positive physical eigenvalue', () => {
    // Same operator, but project out the gradient subspace at every
    // step. The iterate is now restricted to V_perp where K is positive
    // definite — the smallest eigenvalue must be strictly > 0.
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const K = assembleEdgeCurlCurl(mesh, topo, () => 1);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const deflator = buildGradientDeflator(G, M);
    const r = shiftInvertEigenvalue(K, M, {
      shift: 0.05,
      deflator,
      tol: 1e-9,
      maxIter: 200,
    });
    expect(r.converged).toBe(true);
    expect(r.eigenvalue).toBeGreaterThan(1.0);

    // Sanity: the eigenvector should be (a) M-normalised to 1 and
    // (b) M-orthogonal to the gradient subspace.
    const Mx = spmv(M, r.eigenvector);
    expect(dot(r.eigenvector, Mx)).toBeCloseTo(1, 8);
    // Pick an arbitrary nodal scalar f, ⟨G f, x⟩_M should be ≈ 0.
    const numNodes = mesh.vertices.length / 2;
    const f = Float64Array.from(
      Array.from({ length: numNodes }, (_, n) =>
        Math.cos(0.7 * n) + 0.3 * Math.sin(1.5 * n + 1),
      ),
    );
    const Gf = spmv(G, f);
    let inner = 0;
    for (let i = 0; i < Gf.length; i++) inner += Gf[i]! * Mx[i]!;
    // Compare against |Gf|·|Mx| as a scale.
    let normGf = 0;
    let normMx = 0;
    for (let i = 0; i < Gf.length; i++) {
      normGf += Gf[i]! * Gf[i]!;
      normMx += Mx[i]! * Mx[i]!;
    }
    expect(Math.abs(inner)).toBeLessThan(1e-7 * Math.sqrt(normGf * normMx));

    // Generalised-eigenvalue residual: (K − λ M) x ≈ 0.
    // Inverse iteration gives eigenvalue convergence ∝ outer-tol but
    // eigenvector / residual convergence is typically ~ √outer-tol due
    // to the linear convergence rate (μ_2/μ_1)^k. With tol=1e-9 we
    // expect Galerkin residual around 1e-4 — looser than the eigenvalue
    // itself but still firmly tracking the right mode.
    const Kx = spmv(K, r.eigenvector);
    let residualSq = 0;
    let kxNormSq = 0;
    for (let i = 0; i < Kx.length; i++) {
      const ri = Kx[i]! - r.eigenvalue * Mx[i]!;
      residualSq += ri * ri;
      kxNormSq += Kx[i]! * Kx[i]!;
    }
    expect(Math.sqrt(residualSq) / Math.sqrt(kxNormSq)).toBeLessThan(1e-3);
  });
});
