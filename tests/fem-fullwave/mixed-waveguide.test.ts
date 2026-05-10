// @vitest-environment node
/**
 * Mixed (E_t, E_z) waveguide eigenvalue solver — Stage 2.5 validation.
 *
 * Pipeline this exercises end-to-end:
 *
 *   assembleMixedBlocks(mesh, k₀²)        → K_t, M_t, K_n, C_tz
 *   PEC restriction (edges + nodes)       → free blocks
 *   assembleSchurMass(M_t, C_tz, K_n)     → M̃  = M_t − C_tz K_n⁻¹ C_tz^T
 *   shiftInvertEigenvalue(K_t, M̃, …)      → β² closest to σ
 *
 * The Schur reduction collapses the formally quadratic-in-β eigenvalue
 * problem into a linear GEP `K_t u = β² M̃ u` (see `schur.ts`).
 *
 * Validation: closed PEC homogeneous a×b waveguide. With μ_r = ε_r = 1
 * the TE and TM modes decouple and the analytical dispersion is
 *
 *     β²(m, n)  =  k₀²  −  k_c²(m, n),    k_c² = (mπ/a)² + (nπ/b)².
 *
 * The first test pins this: with k₀² ≈ 5 and a=2, b=1, the smallest
 * propagating mode is TE_10 at β² = 5 − π²/4 ≈ 2.533. The shift-invert
 * sigma is set close to that; convergence within a few percent
 * confirms the Schur reduction, the four-block assembly, and the
 * matvec/eigsolver wiring all line up.
 *
 * The second test sweeps k₀ to confirm the linear β²(k₀²) relation
 * holds for the discrete operator: doubling (k₀² − k_c²) should double
 * the recovered β².
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology, findPecEdges } from '../../src/fem-fullwave/edge-dofs';
import {
  partitionDirichlet,
  restrictRect,
  restrictToFree,
} from '../../src/fem-fullwave/boundary';
import { assembleMixedBlocks } from '../../src/fem-fullwave/mixed-assembly';
import { assembleSchurMass } from '../../src/fem-fullwave/schur';
import {
  assembleDiscreteGradient,
  buildGradientDeflator,
} from '../../src/fem-fullwave/gradient';
import { shiftInvertEigenvalue } from '../../src/fem-fullwave/eigsolve';
import type { Mesh } from '../../src/types';

/**
 * Structured triangular mesh of an a×b rectangle with PEC vertex
 * markers (= 1) on the perimeter. Same construction as
 * `closed-waveguide.test.ts` to keep cross-test comparison cheap.
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

interface MixedSolveResult {
  beta2: number;
  outerIterations: number;
}

/**
 * Solve the closed PEC waveguide mixed-system eigenvalue problem at a
 * given (k₀², σ) and return the β² closest to σ.
 *
 * Uses CG for the inner Schur K_n solves (assumes `k₀²` is below the
 * smallest TM cutoff so K_n is SPD on the free-node subspace).
 */
function solveMixedCutoff(
  mesh: Mesh,
  k0Squared: number,
  shift: number,
): MixedSolveResult {
  const topo = buildEdgeTopology(mesh);
  const numNodes = mesh.vertices.length / 2;

  const blocks = assembleMixedBlocks(mesh, topo, {
    epsilonR: () => 1,
    muR: () => 1,
    k0Squared,
  });

  // PEC partitioning: drop boundary edges (E_t · t̂ = 0) and boundary
  // nodes (E_z = 0).
  const pecEdges = findPecEdges(topo, mesh, (m) => m === 1);
  const pecNodes: number[] = [];
  for (let n = 0; n < numNodes; n++) {
    if (mesh.vertexMarkers[n]! === 1) pecNodes.push(n);
  }
  const edgePartition = partitionDirichlet(topo.numEdges, pecEdges);
  const nodePartition = partitionDirichlet(numNodes, pecNodes);

  const KtFree = restrictToFree(blocks.Kt, edgePartition);
  const MtFree = restrictToFree(blocks.Mt, edgePartition);
  const KnFree = restrictToFree(blocks.Kn, nodePartition);
  const CtzFree = restrictRect(blocks.Ctz, edgePartition, nodePartition);

  // Schur-complement mass M̃ = M_t − C_tz K_n⁻¹ C_tz^T.
  const tildeM = assembleSchurMass(MtFree, CtzFree, KnFree, { innerSolver: 'cg' });

  // Gradient deflator on the free-edge subspace. Use M_t (the SPD
  // mass) for the inner product — M̃ may be indefinite, M_t isn't.
  const G = assembleDiscreteGradient(topo, numNodes);
  const GFree = restrictRect(G, edgePartition, nodePartition);
  const deflator = buildGradientDeflator(GFree, MtFree, { pinnedNodes: [] });

  const r = shiftInvertEigenvalue(KtFree, tildeM, {
    shift,
    deflator,
    tol: 1e-9,
    maxIter: 200,
  });
  if (!r.converged) {
    throw new Error(
      `solveMixedCutoff: shift-invert did not converge ` +
        `(λ = ${r.eigenvalue}, outer = ${r.iterations}, inner = ${r.innerIterations})`,
    );
  }
  return { beta2: r.eigenvalue, outerIterations: r.iterations };
}

describe('Mixed-system waveguide eigensolver — homogeneous closed PEC validation', () => {
  it('TE_10 in 2×1 box at k₀²=5 reproduces β² = 5 − π²/4 within 5%', () => {
    const a = 2;
    const b = 1;
    const k0Squared = 5;
    const expected = k0Squared - Math.PI ** 2 / 4;
    // Coarse mesh keeps the Schur assembly (~few hundred inner solves)
    // well under a second on CI hardware.
    const mesh = rectangularPecMesh(13, 7, a, b);
    const r = solveMixedCutoff(mesh, k0Squared, expected);
    const relErr = Math.abs(r.beta2 - expected) / expected;
    expect(relErr).toBeLessThan(0.05);
  });

  it('β²(k₀²) tracks the analytical linear dispersion β² = k₀² − k_c²', () => {
    // Solve at two k₀² values and verify the Δβ² matches Δk₀².
    // (The TE_10 cutoff k_c² stays put, so β² shifts in lockstep.)
    const a = 2;
    const b = 1;
    const mesh = rectangularPecMesh(13, 7, a, b);
    const kcSq = Math.PI ** 2 / 4;
    const k0SqA = 4.0;
    const k0SqB = 6.0;
    const expA = k0SqA - kcSq;
    const expB = k0SqB - kcSq;
    const rA = solveMixedCutoff(mesh, k0SqA, expA);
    const rB = solveMixedCutoff(mesh, k0SqB, expB);
    // Each individual β² close to analytical.
    expect(Math.abs(rA.beta2 - expA) / expA).toBeLessThan(0.05);
    expect(Math.abs(rB.beta2 - expB) / expB).toBeLessThan(0.05);
    // Δβ²(k₀²) shifts by exactly Δk₀² in the analytical limit; the
    // discrete solver should track it within FEM error.
    const deltaActual = rB.beta2 - rA.beta2;
    const deltaExpected = k0SqB - k0SqA;
    expect(Math.abs(deltaActual - deltaExpected) / deltaExpected).toBeLessThan(0.02);
  });
});
