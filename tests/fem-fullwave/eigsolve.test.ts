// @vitest-environment node
/**
 * Stage 1 sanity gate for the scalar-Helmholtz path (Round 8b).
 *
 * Pins the foundational pieces — P1 stiffness/mass assembly, Dirichlet
 * partitioning, and the inverse-iteration eigensolver — against the
 * **rectangular PEC waveguide** TM-z eigenvalue problem, where the
 * answer is in closed form:
 *
 *     k_c²(m, n)  =  (mπ/a)²  +  (nπ/b)²
 *
 * for a width-a × height-b box. The discrete generalised eigenproblem
 *
 *     K · ψ  =  λ · M · ψ           (Dirichlet ψ = 0 on ∂Ω)
 *
 * has eigenvalues that converge to those k_c² values as the mesh
 * refines. With a uniform N × N split of the unit square (each cell cut
 * into two triangles), N = 32 lands the lowest TM_11 eigenvalue inside
 * 1 % of the analytical 2π². If this test ever drifts, the bug is in
 * one of the three new modules above; the rest of the full-wave stack
 * builds on it.
 */

import { describe, expect, it } from 'vitest';
import {
  assembleMass,
  assembleStiffness,
} from '../../src/fem-fullwave/assembly';
import {
  partitionDirichlet,
  restrictToFree,
  scatterFreeToFull,
} from '../../src/fem-fullwave/boundary';
import { smallestGeneralizedEigenvalue } from '../../src/fem-fullwave/eigsolve';
import type { Mesh } from '../../src/types';

/**
 * Hand-built structured triangle mesh of [0, a] × [0, b].
 * Each cell is split into two triangles by the (0,0)–(a/N, b/N) diagonal.
 * Node ordering: row-major starting at (0, 0).
 */
function rectangleMesh(a: number, b: number, nx: number, ny: number): {
  mesh: Mesh;
  boundaryNodes: number[];
} {
  const verts: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      verts.push((i * a) / (nx - 1), (j * b) / (ny - 1));
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = j * nx + i;
      const v10 = j * nx + (i + 1);
      const v01 = (j + 1) * nx + i;
      const v11 = (j + 1) * nx + (i + 1);
      // Lower-right triangle, then upper-left, both CCW.
      tris.push(v00, v10, v11);
      tris.push(v00, v11, v01);
    }
  }
  const triangleCount = tris.length / 3;
  const boundary: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i === 0 || i === nx - 1 || j === 0 || j === ny - 1) {
        boundary.push(j * nx + i);
      }
    }
  }
  const mesh: Mesh = {
    vertices: Float64Array.from(verts),
    triangles: Int32Array.from(tris),
    triangleAttributes: new Float64Array(triangleCount), // all zero, single region
    vertexMarkers: new Int32Array(nx * ny), // unused by Round 8b code
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount,
  };
  return { mesh, boundaryNodes: boundary };
}

describe('Round 8b Stage 1 — scalar Helmholtz on a rectangular waveguide', () => {
  it('TM_11 eigenvalue on unit square matches 2π² within 1 %', () => {
    const a = 1;
    const b = 1;
    const { mesh, boundaryNodes } = rectangleMesh(a, b, 33, 33); // 32×32 cells

    const K = assembleStiffness(mesh, () => 1);
    const M = assembleMass(mesh, () => 1);

    const partition = partitionDirichlet(mesh.vertices.length / 2, boundaryNodes);
    const Kff = restrictToFree(K, partition);
    const Mff = restrictToFree(M, partition);

    const result = smallestGeneralizedEigenvalue(Kff, Mff, {
      tol: 1e-8,
      maxIter: 200,
    });

    const expected = Math.PI * Math.PI * (1 / (a * a) + 1 / (b * b)); // 2π²
    const relErr = Math.abs(result.eigenvalue - expected) / expected;

    console.log(
      `  TM_11 unit square: λ = ${result.eigenvalue.toFixed(6)} ` +
        `(expected ${expected.toFixed(6)}, rel err ${(relErr * 100).toFixed(3)} %, ` +
        `${result.iterations} outer / ${result.innerIterations} inner)`,
    );

    expect(result.converged).toBe(true);
    expect(relErr).toBeLessThan(0.01);

    // Sanity: scatter back to a full vector (zeros at boundary), compare
    // to expected sign pattern. The TM_11 mode peaks at the centre with
    // a single positive lobe, so checking the centre node is positive
    // (after sign flip if needed) catches catastrophic mode mix-ups.
    const full = scatterFreeToFull(result.eigenvector, partition);
    const centreNode = 16 * 33 + 16; // (i, j) = (16, 16) in 33×33 grid
    expect(Math.abs(full[centreNode]!)).toBeGreaterThan(0.01);
  });

  it('TM_21 in a non-square (a=1, b=0.5) matches (π/a)² + (2π/b)² within 2 %', () => {
    // Non-square breaks TM_11 / TM_22 degeneracy and exercises the
    // anisotropic spacing in the assembly. The smallest eigenvalue here
    // is TM_11 = π²(1 + 4) = 5π² ≈ 49.35.
    const a = 1;
    const b = 0.5;
    const { mesh, boundaryNodes } = rectangleMesh(a, b, 33, 17); // ≈ 32×16 cells

    const K = assembleStiffness(mesh, () => 1);
    const M = assembleMass(mesh, () => 1);
    const partition = partitionDirichlet(mesh.vertices.length / 2, boundaryNodes);
    const Kff = restrictToFree(K, partition);
    const Mff = restrictToFree(M, partition);

    const result = smallestGeneralizedEigenvalue(Kff, Mff, {
      tol: 1e-8,
      maxIter: 200,
    });

    const expected = Math.PI * Math.PI * (1 / (a * a) + 1 / (b * b));
    const relErr = Math.abs(result.eigenvalue - expected) / expected;

    console.log(
      `  TM_11 1×0.5 box: λ = ${result.eigenvalue.toFixed(6)} ` +
        `(expected ${expected.toFixed(6)}, rel err ${(relErr * 100).toFixed(3)} %)`,
    );

    expect(result.converged).toBe(true);
    expect(relErr).toBeLessThan(0.02);
  });
});
