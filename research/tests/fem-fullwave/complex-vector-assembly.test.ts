// @vitest-environment node
/**
 * Complex / anisotropic edge-DoF assembly (Round 8c Stage 3a-iii).
 *
 * Validation strategy:
 *
 *   1. **Reduction to the real isotropic path** — when the
 *      anisotropic tensor is α = diag(α₀, α₀) with α₀ real, the
 *      complex output must equal the existing real-valued output
 *      (with imaginary parts at FP zero). This pins the basic
 *      multiply-and-accumulate code without trusting any new
 *      formulae; if either matches, both are right.
 *
 *   2. **True anisotropy changes the answer** — αxx ≠ αyy must
 *      produce a different matrix. Otherwise we'd accept a buggy
 *      tensor product that always sums isotropically.
 *
 *   3. **Symmetry of the mass / curl-curl** — for any symmetric α
 *      (xx, yy diagonal), the assembled matrix is complex symmetric
 *      (`A_{ij} = A_{ji}` with no conjugation). This is what
 *      complex-symmetric Krylov solvers count on.
 *
 *   4. **Rectangular shape and zero of C·1** — the coupling block is
 *      numEdges × numNodes and still annihilates the constant nodal
 *      field (∇·1 = 0).
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
  assembleEdgeNodeCoupling,
} from '../../src/fem-fullwave/vector-assembly';
import {
  assembleEdgeCurlCurlComplex,
  assembleEdgeMassAniso,
  assembleEdgeNodeCouplingAniso,
} from '../../src/fem-fullwave/complex-vector-assembly';
import { cspmv } from '../../src/fem-fullwave/complex-sparse';
import type { Mesh } from '../../../src/types';

/** 2-triangle unit square (same fixture as `vector-assembly.test.ts`). */
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

/** Materialise a complex CSR matrix into a dense (re, im) 2-D array
 *  for symmetry / equality checks on small problems. */
function complexToDense(
  M: ReturnType<typeof assembleEdgeCurlCurlComplex>,
): { re: number[][]; im: number[][] } {
  const re: number[][] = Array.from({ length: M.numRows }, () =>
    new Array<number>(M.numCols).fill(0),
  );
  const im: number[][] = Array.from({ length: M.numRows }, () =>
    new Array<number>(M.numCols).fill(0),
  );
  for (let i = 0; i < M.numRows; i++) {
    for (let k = M.rowPtr[i]!; k < M.rowPtr[i + 1]!; k++) {
      const j = M.colIdx[k]!;
      re[i]![j]! += M.values[2 * k]!;
      im[i]![j]! += M.values[2 * k + 1]!;
    }
  }
  return { re, im };
}

/** Same for a real CSR. */
function realToDense(M: ReturnType<typeof assembleEdgeCurlCurl>): number[][] {
  const dense: number[][] = Array.from({ length: M.numRows }, () =>
    new Array<number>(M.numCols).fill(0),
  );
  for (let i = 0; i < M.numRows; i++) {
    for (let k = M.rowPtr[i]!; k < M.rowPtr[i + 1]!; k++) {
      dense[i]![M.colIdx[k]!]! += M.values[k]!;
    }
  }
  return dense;
}

describe('Complex / anisotropic edge assembly — reduction to real isotropic', () => {
  it('curl-curl with γ = (1.7, 0) matches the real assembly with weight 1.7', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const Kreal = assembleEdgeCurlCurl(mesh, topo, () => 1.7);
    const Kcomplex = assembleEdgeCurlCurlComplex(mesh, topo, () => ({
      re: 1.7,
      im: 0,
    }));
    const denseR = realToDense(Kreal);
    const denseC = complexToDense(Kcomplex);
    for (let i = 0; i < Kreal.numRows; i++) {
      for (let j = 0; j < Kreal.numCols; j++) {
        expect(denseC.re[i]![j]).toBeCloseTo(denseR[i]![j]!, 12);
        expect(denseC.im[i]![j]).toBe(0);
      }
    }
  });

  it('vector mass with diag(α, α) real matches the isotropic assembly', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const Mreal = assembleEdgeMass(mesh, topo, () => 2.3);
    const Mcomplex = assembleEdgeMassAniso(mesh, topo, () => ({
      xx: { re: 2.3, im: 0 },
      yy: { re: 2.3, im: 0 },
    }));
    const denseR = realToDense(Mreal);
    const denseC = complexToDense(Mcomplex);
    for (let i = 0; i < Mreal.numRows; i++) {
      for (let j = 0; j < Mreal.numCols; j++) {
        expect(denseC.re[i]![j]).toBeCloseTo(denseR[i]![j]!, 12);
        expect(denseC.im[i]![j]).toBe(0);
      }
    }
  });

  it('edge-node coupling with diag(α, α) real matches the isotropic assembly', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const Creal = assembleEdgeNodeCoupling(mesh, topo, () => 1.5);
    const Ccomplex = assembleEdgeNodeCouplingAniso(mesh, topo, () => ({
      xx: { re: 1.5, im: 0 },
      yy: { re: 1.5, im: 0 },
    }));
    expect(Ccomplex.numRows).toBe(Creal.numRows);
    expect(Ccomplex.numCols).toBe(Creal.numCols);
    const denseR = realToDense(Creal);
    const denseC = complexToDense(Ccomplex);
    for (let i = 0; i < Creal.numRows; i++) {
      for (let j = 0; j < Creal.numCols; j++) {
        expect(denseC.re[i]![j]).toBeCloseTo(denseR[i]![j]!, 12);
        expect(denseC.im[i]![j]).toBe(0);
      }
    }
  });
});

describe('Complex / anisotropic edge assembly — true anisotropy', () => {
  it('αxx ≠ αyy gives a different mass matrix from the isotropic average', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    // Anisotropic α = diag(1, 4). Average is 2.5 — pick that for the
    // isotropic comparison; anisotropic can't be that for both axes
    // unless the mesh happens to be diagonally symmetric (it isn't).
    const Maniso = assembleEdgeMassAniso(mesh, topo, () => ({
      xx: { re: 1, im: 0 },
      yy: { re: 4, im: 0 },
    }));
    const Miso = assembleEdgeMassAniso(mesh, topo, () => ({
      xx: { re: 2.5, im: 0 },
      yy: { re: 2.5, im: 0 },
    }));
    const dA = complexToDense(Maniso);
    const dI = complexToDense(Miso);
    let maxDiff = 0;
    for (let i = 0; i < Maniso.numRows; i++) {
      for (let j = 0; j < Maniso.numCols; j++) {
        maxDiff = Math.max(maxDiff, Math.abs(dA.re[i]![j]! - dI.re[i]![j]!));
      }
    }
    // A non-trivial anisotropy must show up somewhere.
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('imaginary tensor entries propagate into the assembled matrix', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const Mc = assembleEdgeMassAniso(mesh, topo, () => ({
      xx: { re: 1, im: 0.5 },
      yy: { re: 1, im: -0.3 },
    }));
    const dense = complexToDense(Mc);
    let imSum = 0;
    for (let i = 0; i < Mc.numRows; i++) {
      for (let j = 0; j < Mc.numCols; j++) {
        imSum += Math.abs(dense.im[i]![j]!);
      }
    }
    // The imaginary parts of α must propagate to non-zero matrix imag.
    expect(imSum).toBeGreaterThan(0.01);
  });
});

describe('Complex / anisotropic edge assembly — structural properties', () => {
  it('curl-curl is complex symmetric for a complex scalar weight', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const K = assembleEdgeCurlCurlComplex(mesh, topo, () => ({
      re: 1.2,
      im: -0.7,
    }));
    const d = complexToDense(K);
    for (let i = 0; i < K.numRows; i++) {
      for (let j = i + 1; j < K.numCols; j++) {
        expect(d.re[i]![j]).toBeCloseTo(d.re[j]![i]!, 12);
        expect(d.im[i]![j]).toBeCloseTo(d.im[j]![i]!, 12);
      }
    }
  });

  it('vector mass is complex symmetric for a diagonal tensor weight', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const M = assembleEdgeMassAniso(mesh, topo, () => ({
      xx: { re: 1.1, im: 0.2 },
      yy: { re: 0.7, im: -0.5 },
    }));
    const d = complexToDense(M);
    for (let i = 0; i < M.numRows; i++) {
      for (let j = i + 1; j < M.numCols; j++) {
        expect(d.re[i]![j]).toBeCloseTo(d.re[j]![i]!, 12);
        expect(d.im[i]![j]).toBeCloseTo(d.im[j]![i]!, 12);
      }
    }
  });

  it('edge-node coupling annihilates a constant nodal field for any tensor', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const C = assembleEdgeNodeCouplingAniso(mesh, topo, () => ({
      xx: { re: 2, im: 0.4 },
      yy: { re: 1.3, im: -0.6 },
    }));
    const numNodes = mesh.vertices.length / 2;
    // ones nodal vector, complex (im = 0)
    const ones = new Float64Array(2 * numNodes);
    for (let n = 0; n < numNodes; n++) ones[2 * n] = 1;
    const Cones = cspmv(C, ones);
    for (let i = 0; i < Cones.length; i++) {
      expect(Math.abs(Cones[i]!)).toBeLessThan(1e-12);
    }
  });

  it('coupling matrix is rectangular numEdges × numNodes', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const C = assembleEdgeNodeCouplingAniso(mesh, topo, () => ({
      xx: { re: 1, im: 0 },
      yy: { re: 1, im: 0 },
    }));
    expect(C.numRows).toBe(topo.numEdges);
    expect(C.numCols).toBe(mesh.vertices.length / 2);
  });
});
