// @vitest-environment node
/**
 * `solveMixedSystemPml` end-to-end wrapper regression
 * (Round 8c Stage 3a-vi-a).
 *
 * The wrapper consolidates the full PML pipeline — assembly, PEC
 * restriction, Schur, deflator, complex shift-invert, optional E_z
 * recovery — into one call. These tests confirm it reproduces the
 * Stage 2.5 / 2.6 closed-waveguide eigenvalues when run with
 * `noPml()` (κ = 0). If that holds, the wrapper is a drop-in for
 * arbitrary PML configurations (open boundaries, microstrip
 * truncation) without regressing the closed-domain validation suite.
 *
 * Two scenarios:
 *   - Homogeneous closed PEC, TE_10 in 2×1 box at k₀² = 5
 *   - Inhomogeneous closed PEC, ε_r = 4 in lower half, k₀² = 5
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import { solveMixedSystemPml } from '../../src/fem-fullwave/pml-eigensolve';
import { noPml } from '../../src/fem-fullwave/pml';
import type { Mesh } from '../../../src/types';

function rectangularPecMesh(
  nx: number,
  ny: number,
  a: number,
  b: number,
): Mesh {
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

/** Same mesh with bottom-half triangles tagged attribute 1 (dielectric). */
function rectangularPecMeshHalfDielectric(
  nx: number,
  ny: number,
  a: number,
  b: number,
): Mesh {
  const base = rectangularPecMesh(nx, ny, a, b);
  for (let t = 0; t < base.triangleCount; t++) {
    const v0 = base.triangles[3 * t]!;
    const v1 = base.triangles[3 * t + 1]!;
    const v2 = base.triangles[3 * t + 2]!;
    const cy =
      (base.vertices[2 * v0 + 1]! +
        base.vertices[2 * v1 + 1]! +
        base.vertices[2 * v2 + 1]!) /
      3;
    base.triangleAttributes[t] = cy < b / 2 ? 1 : 0;
  }
  return base;
}

describe('solveMixedSystemPml — wrapper regression on closed waveguides', () => {
  it('TE_10 in homogeneous 2×1 box at k₀² = 5 (κ = 0) reproduces β² = 2.533', () => {
    const a = 2;
    const b = 1;
    const k0Squared = 5;
    const expected = k0Squared - Math.PI ** 2 / 4;
    const mesh = rectangularPecMesh(13, 7, a, b);
    const topo = buildEdgeTopology(mesh);

    const r = solveMixedSystemPml(mesh, topo, {
      epsilonR: () => 1,
      muR: () => 1,
      pml: noPml(),
      k0Squared,
      shift: { re: expected, im: 0 },
      isPecMarker: (m) => m === 1,
      outerTol: 1e-8,
    });

    expect(r.converged).toBe(true);
    expect(Math.abs(r.beta2.im)).toBeLessThan(1e-6);
    const relErr = Math.abs(r.beta2.re - expected) / expected;
    expect(relErr).toBeLessThan(0.05);

    // E_z recovery should succeed and produce a vector of the right size.
    expect(r.eFreeNodes.length).toBe(2 * r.nodePartition.freeIndices.length);
    // For pure TE_10, E_z is zero analytically — the discrete v should
    // be small relative to the edge eigenvector u. Comparing
    // ‖v‖₂ / ‖u‖₂ catches the broad case.
    const norm2 = (vec: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < vec.length; i++) s += vec[i]! * vec[i]!;
      return Math.sqrt(s);
    };
    const ratio = norm2(r.eFreeNodes) / norm2(r.eFreeEdges);
    expect(ratio).toBeLessThan(0.5); // at coarse mesh, E_z bleed-through is bounded
  });

  it('Inhomogeneous (ε_r = 4 in lower half) at k₀² = 5 produces a sensible β²', () => {
    // Same setup as Stage 2.6 half-filled bracket test. Without an
    // analytical formula for the LSE_10 mode, just check the result is
    // in the bracket between air-only and uniform-ε limits.
    const a = 2;
    const b = 1;
    const k0Squared = 5;
    const eps = 4;
    const mesh = rectangularPecMeshHalfDielectric(13, 7, a, b);
    const topo = buildEdgeTopology(mesh);

    const r = solveMixedSystemPml(mesh, topo, {
      epsilonR: (attr) => (attr === 1 ? eps : 1),
      muR: () => 1,
      pml: noPml(),
      k0Squared,
      shift: { re: 9, im: 0 }, // mid-bracket guess
      isPecMarker: (m) => m === 1,
      outerTol: 1e-8,
    });

    expect(r.converged).toBe(true);
    expect(Math.abs(r.beta2.im)).toBeLessThan(1e-6);
    const airLimit = k0Squared - Math.PI ** 2 / 4; // ≈ 2.533
    const dielLimit = eps * k0Squared - Math.PI ** 2 / 4; // ≈ 17.533
    expect(r.beta2.re).toBeGreaterThan(airLimit);
    expect(r.beta2.re).toBeLessThan(dielLimit);
  });
});
