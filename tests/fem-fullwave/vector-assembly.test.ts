// @vitest-environment node
/**
 * Edge-DoF assembly checks (Vector Stage 2.1).
 *
 * The hard validation of curl-curl + vector mass comes later when we
 * solve the closed-rectangular-waveguide eigenvalue problem (Stage 2.4).
 * What this file pins is the structural correctness of the assembly:
 *
 *   1. Both matrices come out symmetric (orientation signs really
 *      cancel along shared edges).
 *
 *   2. Curl-curl annihilates uniform-field DoFs. ∇×(constant) = 0, so
 *      the DoF vector encoding `E = (Ex, Ey)` must lie in the null
 *      space of K_tt to floating-point round-off. This is the cleanest
 *      sanity check on both the orientation handling and the curl
 *      formula — if either is wrong, the residual blows up.
 *
 *   3. Vector mass on uniform DoFs reproduces the area integral of
 *      |E|². For E = (1, 0) and the unit square Ω = [0,1]², we expect
 *      uᵀ M_tt u = ∫|E|² dA = 1.
 *
 *   4. Mass / stiffness scale correctly when the mesh is enlarged:
 *      stiffness ∝ 1/s² (curl² · A) and mass ∝ 1 (|N|² · A), exactly
 *      as the per-element analysis in `nedelec.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import { spmv } from '../../src/fem/sparse';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
  uniformFieldDofs,
} from '../../src/fem-fullwave/vector-assembly';
import type { Mesh } from '../../src/types';

/**
 * 2-triangle unit square: vertices (0,0), (1,0), (1,1), (0,1) split
 * along the (0,0)-(1,1) diagonal. Same geometry as nedelec.test.ts so
 * tests can be cross-referenced.
 */
function unitSquareMesh(): Mesh {
  return {
    vertices: Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    triangles: Int32Array.from([0, 1, 2, 0, 2, 3]),
    triangleAttributes: new Float64Array(2),
    vertexMarkers: new Int32Array(4),
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: 2,
  };
}

/** Same mesh, scaled by `s` in both axes. */
function scaledSquareMesh(s: number): Mesh {
  return {
    vertices: Float64Array.from([0, 0, s, 0, s, s, 0, s]),
    triangles: Int32Array.from([0, 1, 2, 0, 2, 3]),
    triangleAttributes: new Float64Array(2),
    vertexMarkers: new Int32Array(4),
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: 2,
  };
}

/** Dense materialise of a CSR matrix for symmetry checks on small problems. */
function csrToDense(M: { n: number; rowPtr: Int32Array; colIdx: Int32Array; values: Float64Array }): number[][] {
  const dense: number[][] = Array.from({ length: M.n }, () =>
    new Array<number>(M.n).fill(0),
  );
  for (let i = 0; i < M.n; i++) {
    for (let k = M.rowPtr[i]!; k < M.rowPtr[i + 1]!; k++) {
      dense[i]![M.colIdx[k]!]! += M.values[k]!;
    }
  }
  return dense;
}

describe('Vector Stage 2.1 — edge-DoF assembly', () => {
  it('vector mass is symmetric on the 2-tri unit square', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const dense = csrToDense(M);
    for (let i = 0; i < dense.length; i++) {
      for (let j = i + 1; j < dense.length; j++) {
        expect(dense[i]![j]).toBeCloseTo(dense[j]![i]!, 12);
      }
    }
  });

  it('curl-curl is symmetric on the 2-tri unit square', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const K = assembleEdgeCurlCurl(mesh, topo, () => 1);
    const dense = csrToDense(K);
    for (let i = 0; i < dense.length; i++) {
      for (let j = i + 1; j < dense.length; j++) {
        expect(dense[i]![j]).toBeCloseTo(dense[j]![i]!, 12);
      }
    }
  });

  it('curl-curl annihilates uniform-field DoFs (∇×constant = 0)', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const K = assembleEdgeCurlCurl(mesh, topo, () => 1);
    // E = (1, 0)
    const dofX = uniformFieldDofs(mesh, topo, 1, 0);
    const Kdofx = spmv(K, dofX);
    for (const v of Kdofx) expect(v).toBeCloseTo(0, 10);
    // E = (0, 1)
    const dofY = uniformFieldDofs(mesh, topo, 0, 1);
    const Kdofy = spmv(K, dofY);
    for (const v of Kdofy) expect(v).toBeCloseTo(0, 10);
    // E = (3, -2) — arbitrary linear combination still gradient-free
    const dofMix = uniformFieldDofs(mesh, topo, 3, -2);
    const Kmix = spmv(K, dofMix);
    for (const v of Kmix) expect(v).toBeCloseTo(0, 10);
  });

  it('vector mass on uniform-field DoFs reproduces ∫|E|² dA on unit square', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    // E = (1, 0), domain area = 1, so uᵀMu should be ≈ 1.
    const dofX = uniformFieldDofs(mesh, topo, 1, 0);
    const Mu = spmv(M, dofX);
    let energy = 0;
    for (let i = 0; i < dofX.length; i++) energy += dofX[i]! * Mu[i]!;
    expect(energy).toBeCloseTo(1, 10);
    // E = (3, -2): ∫|E|² dA = (9 + 4) · 1 = 13
    const dofMix = uniformFieldDofs(mesh, topo, 3, -2);
    const Mmix = spmv(M, dofMix);
    let energyMix = 0;
    for (let i = 0; i < dofMix.length; i++) energyMix += dofMix[i]! * Mmix[i]!;
    expect(energyMix).toBeCloseTo(13, 10);
  });

  it('uniform scaling: K_tt ∝ 1/s², M_tt ∝ 1 (matches per-element analysis)', () => {
    const s = 4;
    const m1 = unitSquareMesh();
    const ms = scaledSquareMesh(s);
    const t1 = buildEdgeTopology(m1);
    const ts = buildEdgeTopology(ms);
    // For a uniform field on the scaled square, ∫|E|² dA = |E|² · s².
    // The DoF vector for the scaled mesh is also s× the unit-square one
    // (line integrals scale linearly), so uᵀMu picks up s²·s² = s⁴
    // unless mass scales as 1/s² globally (which it doesn't — the
    // per-element matrix M_e is invariant in s, but the DoF integrals
    // scale by s, hence energy ~ s² · M_e_const).
    //
    // Simpler check: scale-invariance of the diagonal sum (Tr) of the
    // mass matrix when divided by s² (energy normalisation).
    const M1 = assembleEdgeMass(m1, t1, () => 1);
    const Ms = assembleEdgeMass(ms, ts, () => 1);
    const K1 = assembleEdgeCurlCurl(m1, t1, () => 1);
    const Ks = assembleEdgeCurlCurl(ms, ts, () => 1);
    // Diagonal sums.
    const tr = (M: { n: number; rowPtr: Int32Array; colIdx: Int32Array; values: Float64Array }) => {
      let t = 0;
      for (let i = 0; i < M.n; i++) {
        for (let k = M.rowPtr[i]!; k < M.rowPtr[i + 1]!; k++) {
          if (M.colIdx[k]! === i) t += M.values[k]!;
        }
      }
      return t;
    };
    // M_tt: per-element matrix is dimension-less of s, so global trace
    // is also invariant.
    expect(tr(Ms)).toBeCloseTo(tr(M1), 10);
    // K_tt: per-element matrix scales as 1/s², so global trace scales
    // the same way.
    expect(tr(Ks)).toBeCloseTo(tr(K1) / (s * s), 10);
  });
});
