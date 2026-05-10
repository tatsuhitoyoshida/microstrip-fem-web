// @vitest-environment node
/**
 * End-to-end PML pipeline validation (Round 8c Stage 3a-v-c-3).
 *
 * Runs the **entire** PML stack from assembly through eigenvalue
 * recovery, with `noPml()` (κ_max = 0) so the answer must coincide
 * with the existing real-track Stage 2.5 closed-waveguide result.
 *
 * The pipeline this exercises in order:
 *
 *   assembleMixedBlocksPml           → complex K_t, M_t, K_n, C_tz
 *   PEC restriction (complex)        → free-DoF blocks
 *   assembleSchurMassComplex          → complex M̃ via inner BiCGStab
 *   buildGradientDeflatorComplex     → complex M-orthogonal projector
 *   shiftInvertEigenvalueComplex      → β² complex
 *
 * For κ = 0 the matrices are real (im=0) and the recovered β² must
 * be real to FP precision and equal to the analytical TE_10 cutoff
 * formula β² = k₀² − (π/a)² used in `mixed-waveguide.test.ts`.
 *
 * If any link in the chain has a sign / scaling drift relative to
 * the real path, the eigenvalue won't land. That's why we run the
 * full stack rather than spot-checking individual links — a
 * positional bug in (say) `assembleScalarStiffnessAniso` could pass
 * its own unit test (which only checks shape / symmetry) but break
 * the mixed-system answer.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEdgeTopology,
  findPecEdges,
} from '../../src/fem-fullwave/edge-dofs';
import {
  partitionDirichlet,
  restrictRect,
  restrictRectComplex,
  restrictToFreeComplex,
} from '../../src/fem-fullwave/boundary';
import { assembleMixedBlocksPml } from '../../src/fem-fullwave/mixed-pml-assembly';
import { assembleSchurMassComplex } from '../../src/fem-fullwave/complex-schur';
import { buildGradientDeflatorComplex } from '../../src/fem-fullwave/complex-gradient';
import { assembleDiscreteGradient } from '../../src/fem-fullwave/gradient';
import { shiftInvertEigenvalueComplex } from '../../src/fem-fullwave/complex-eigsolve';
import { noPml } from '../../src/fem-fullwave/pml';
import type { Mesh } from '../../../src/types';

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

describe('Closed PEC waveguide — full PML pipeline with κ = 0 must match real path', () => {
  it('TE_10 in 2×1 box at k₀² = 5 recovers β² = 5 − π²/4 within 5%', () => {
    const a = 2;
    const b = 1;
    const k0Squared = 5;
    const expected = k0Squared - Math.PI ** 2 / 4; // ≈ 2.533
    const mesh = rectangularPecMesh(13, 7, a, b);
    const topo = buildEdgeTopology(mesh);
    const numNodes = mesh.vertices.length / 2;

    // Assemble complex blocks via the PML path with no PML.
    const blocks = assembleMixedBlocksPml(mesh, topo, {
      pml: noPml(),
      muR: () => 1,
      epsR: () => 1,
      k0Squared,
    });

    // PEC partitioning (same as real-track Stage 2.5).
    const pecEdges = findPecEdges(topo, mesh, (m) => m === 1);
    const edgePartition = partitionDirichlet(topo.numEdges, pecEdges);
    const pecNodes: number[] = [];
    for (let n = 0; n < numNodes; n++) {
      if (mesh.vertexMarkers[n]! === 1) pecNodes.push(n);
    }
    const nodePartition = partitionDirichlet(numNodes, pecNodes);

    const KtFree = restrictToFreeComplex(blocks.Kt, edgePartition);
    const MtFree = restrictToFreeComplex(blocks.Mt, edgePartition);
    const KnFree = restrictToFreeComplex(blocks.Kn, nodePartition);
    const CtzFree = restrictRectComplex(
      blocks.Ctz,
      edgePartition,
      nodePartition,
    );

    // Schur-complement mass via complex BiCGStab inner solve.
    const tildeM = assembleSchurMassComplex(MtFree, CtzFree, KnFree);

    // Gradient deflator: G is real (incidence ±1), M_t is complex.
    // Reuse the real `restrictRect` to project G into the free-DoF
    // subspace, then hand off to the complex deflator builder.
    const G = assembleDiscreteGradient(topo, numNodes);
    const Gfree = restrictRect(G, edgePartition, nodePartition);
    const deflator = buildGradientDeflatorComplex(Gfree, MtFree, {
      pinnedNodes: [],
    });

    const r = shiftInvertEigenvalueComplex(KtFree, tildeM, {
      shift: { re: expected, im: 0 },
      deflator,
      tol: 1e-8,
      maxIter: 200,
    });
    expect(r.converged).toBe(true);
    // β² should be real (no PML loss); imag part FP zero.
    expect(Math.abs(r.eigenvalue.im)).toBeLessThan(1e-6);
    const relErr = Math.abs(r.eigenvalue.re - expected) / expected;
    expect(relErr).toBeLessThan(0.05);
  });
});
