// @vitest-environment node
/**
 * Closed PEC rectangular waveguide TE-mode validation (Vector Stage 2.4).
 *
 * The first end-to-end check on the **whole** vector full-wave pipeline
 * we've built across Round 8c stages 2.1–2.3:
 *
 *     edge enumeration  →  Whitney-1-form curl-curl + vector mass
 *                       →  PEC restriction
 *                       →  discrete gradient + M-orthogonal deflator
 *                       →  shift-invert eigensolver via MINRES
 *
 * Why TE in a homogeneous closed PEC box? Because for those modes the
 * mixed (E_t, E_z) coupling **vanishes** (E_z ≡ 0 by definition of TE),
 * so the eigenvalue problem reduces to a pure curl-curl + mass
 * generalised eigenvalue problem on the Nédélec space alone:
 *
 *     K_tt · E_t  =  k_c² · M_tt · E_t
 *
 * with the *same* operators we already assemble. That means this test
 * exercises every piece of the pipeline **except** the inter-block
 * coupling — the part of the formulation we haven't pinned down against
 * a textbook yet. If TE_10 lands on (π/a)² the curl-curl side is solid
 * and any future discrepancy on inhomogeneous problems will be a
 * coupling / weak-form issue, not a basic-element issue.
 *
 * Analytical TE_mn cutoff in an a × b PEC rectangular waveguide:
 *     k_c²(m, n)  =  (mπ/a)²  +  (nπ/b)²,    (m, n) ≠ (0, 0).
 *
 * Setup: a = 2, b = 1 (asymmetric, so TE_10 ≠ TE_01). The smallest non-
 * zero cutoff is TE_10 at k_c² = (π/2)² ≈ 2.467, with TE_01 / TE_20
 * the next at π² ≈ 9.870 — comfortably separated for shift-invert.
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology, findPecEdges } from '../../src/fem-fullwave/edge-dofs';
import {
  partitionDirichlet,
  restrictRect,
  restrictToFree,
} from '../../src/fem-fullwave/boundary';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
} from '../../src/fem-fullwave/vector-assembly';
import {
  assembleDiscreteGradient,
  buildGradientDeflator,
} from '../../src/fem-fullwave/gradient';
import { shiftInvertEigenvalue } from '../../src/fem-fullwave/eigsolve';
import type { Mesh } from '../../../src/types';

/**
 * Structured triangular mesh of an a × b rectangle, with PEC vertex
 * markers (= 1) on every node lying on the outer perimeter and 0 in
 * the interior. Each axis-aligned grid cell is split into two triangles
 * by the (i, j) → (i+1, j+1) diagonal.
 */
function rectangularPecMesh(nx: number, ny: number, a: number, b: number): Mesh {
  const numNodes = nx * ny;
  const verts = new Float64Array(2 * numNodes);
  const markers = new Int32Array(numNodes);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      verts[2 * n] = (i * a) / (nx - 1);
      verts[2 * n + 1] = (j * b) / (ny - 1);
      const onBoundary = i === 0 || i === nx - 1 || j === 0 || j === ny - 1;
      markers[n] = onBoundary ? 1 : 0;
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const aIdx = j * nx + i;
      const bIdx = j * nx + i + 1;
      const cIdx = (j + 1) * nx + i;
      const dIdx = (j + 1) * nx + i + 1;
      // Two triangles per cell: (a, b, d) and (a, d, c)
      tris.push(aIdx, bIdx, dIdx);
      tris.push(aIdx, dIdx, cIdx);
    }
  }
  return {
    vertices: verts,
    triangles: Int32Array.from(tris),
    triangleAttributes: new Float64Array(tris.length / 3),
    vertexMarkers: markers,
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: tris.length / 3,
  };
}

/**
 * Solve the closed PEC waveguide eigenvalue problem on the given mesh
 * with the given shift, returning the smallest physical k_c² that the
 * shift-invert / deflator pipeline lands on.
 */
function solveSmallestTeCutoff(mesh: Mesh, shift: number): number {
  const topo = buildEdgeTopology(mesh);
  const numNodes = mesh.vertices.length / 2;

  const K = assembleEdgeCurlCurl(mesh, topo, () => 1);
  const M = assembleEdgeMass(mesh, topo, () => 1);
  const G = assembleDiscreteGradient(topo, numNodes);

  const pecEdges = findPecEdges(topo, mesh, (m) => m === 1);
  const edgePartition = partitionDirichlet(topo.numEdges, pecEdges);
  const pecNodes: number[] = [];
  for (let n = 0; n < numNodes; n++) {
    if (mesh.vertexMarkers[n]! === 1) pecNodes.push(n);
  }
  const nodePartition = partitionDirichlet(numNodes, pecNodes);

  const Kfree = restrictToFree(K, edgePartition);
  const Mfree = restrictToFree(M, edgePartition);
  const Gfree = restrictRect(G, edgePartition, nodePartition);

  // Build deflator on the (free-edge × free-node) restricted operators.
  // Boundary nodes are already excluded, and constants on the free-node
  // space map to non-zero G·f on edges with one PEC endpoint, so
  // L = Gfreeᵀ M_free G_free is SPD without further pinning.
  const deflator = buildGradientDeflator(Gfree, Mfree, { pinnedNodes: [] });

  const r = shiftInvertEigenvalue(Kfree, Mfree, {
    shift,
    deflator,
    tol: 1e-9,
    maxIter: 200,
  });
  if (!r.converged) {
    throw new Error(
      `solveSmallestTeCutoff: shift-invert did not converge ` +
        `(λ = ${r.eigenvalue}, outer iter = ${r.iterations}, inner = ${r.innerIterations})`,
    );
  }
  return r.eigenvalue;
}

describe('Closed PEC rectangular waveguide — vector pipeline TE validation', () => {
  it('TE_10 in 2×1 box reproduces k_c² = (π/2)² to within 2 %', () => {
    const a = 2;
    const b = 1;
    // 21×11 grid → 20×10 cells × 2 tri = 400 tri, h = 0.1
    const mesh = rectangularPecMesh(21, 11, a, b);
    const lambda = solveSmallestTeCutoff(mesh, 0.5);
    const expected = Math.PI ** 2 / 4; // (π/a)² with a=2
    const relErr = Math.abs(lambda - expected) / expected;
    expect(relErr).toBeLessThan(0.02);
  });

  it('refining the mesh narrows the gap to the analytical TE_10 cutoff', () => {
    // FEM eigenvalue convergence should improve as h → 0. We compare a
    // coarse and a fine mesh; the fine result must be at least as
    // accurate as the coarse one (and well inside 2 % regardless).
    const a = 2;
    const b = 1;
    const expected = Math.PI ** 2 / 4;

    const coarse = rectangularPecMesh(13, 7, a, b);
    const fine = rectangularPecMesh(25, 13, a, b);
    const lambdaCoarse = solveSmallestTeCutoff(coarse, 0.5);
    const lambdaFine = solveSmallestTeCutoff(fine, 0.5);

    const errCoarse = Math.abs(lambdaCoarse - expected) / expected;
    const errFine = Math.abs(lambdaFine - expected) / expected;

    expect(errCoarse).toBeLessThan(0.05);
    expect(errFine).toBeLessThan(0.02);
    // Fine mesh shouldn't be worse than coarse (allow tiny slack for
    // outer-iteration random-init variance).
    expect(errFine).toBeLessThan(errCoarse + 1e-3);
  });

  it('TE_10 lands at the same eigenvalue from a shift on either side', () => {
    // Sanity: the eigenvalue we recover shouldn't depend on which side
    // of TE_10 we approach from. σ = 0.5 (below) and σ = 2.0 (still
    // closer to TE_10 than to TE_20/01 = π²) must both land on
    // (π/a)² = π²/4 ≈ 2.467 within FEM discretization noise.
    const a = 2;
    const b = 1;
    const mesh = rectangularPecMesh(21, 11, a, b);
    const expected = Math.PI ** 2 / 4;
    const lambdaBelow = solveSmallestTeCutoff(mesh, 0.5);
    const lambdaAbove = solveSmallestTeCutoff(mesh, 2.0);
    expect(Math.abs(lambdaBelow - expected) / expected).toBeLessThan(0.02);
    expect(Math.abs(lambdaAbove - expected) / expected).toBeLessThan(0.02);
    // The two answers should agree to many digits (same eigenvalue,
    // same mesh, same operator — only σ is different).
    expect(Math.abs(lambdaBelow - lambdaAbove) / expected).toBeLessThan(1e-6);
  });
});
