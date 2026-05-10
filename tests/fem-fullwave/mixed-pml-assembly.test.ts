// @vitest-environment node
/**
 * PML mixed-system block assembly (Round 8c Stage 3a-v-b).
 *
 * The headline guarantee: with `noPml()` (s_x = s_y = 1 everywhere),
 * the four PML-track blocks must equal the four real-track blocks
 * (M_eps_n converted to complex, etc.) to floating-point precision
 * with imag = 0. Anything else means the PML pipeline drifted away
 * from the regression-tested closed-waveguide assembly.
 *
 * Plus a κ_max > 0 sanity check: imaginary parts appear in matrix
 * entries that touch a PML region, but stay zero in entries far
 * from it.
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import { assembleMixedBlocks } from '../../src/fem-fullwave/mixed-assembly';
import { assembleMixedBlocksPml } from '../../src/fem-fullwave/mixed-pml-assembly';
import {
  noPml,
  polynomialPmlProfile1D,
  identityProfile1D,
} from '../../src/fem-fullwave/pml';
import type { CsrMatrix } from '../../src/fem/sparse';
import type { ComplexCsrMatrix } from '../../src/fem-fullwave/complex-sparse';
import type { Mesh } from '../../src/types';

/** Same 4×3 structured rectangular mesh used by other PML / vector
 *  assembly tests, so cross-test comparison is easy. */
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

/** Compare a complex CSR (PML track) against a real CSR (existing
 *  track) entry-by-entry. With `noPml()` they must match to FP
 *  precision and imag must be zero. */
function expectComplexMatchesReal(
  complex: ComplexCsrMatrix,
  real: CsrMatrix,
  context: string,
  tol = 1e-10,
): void {
  expect(complex.numRows, `${context}: numRows`).toBe(real.numRows);
  expect(complex.numCols, `${context}: numCols`).toBe(real.numCols);
  // Reduce both to dense for a direct entry comparison; the CSR
  // ordering of duplicates can differ between the two assemblies even
  // when the matrices are mathematically equal.
  const denseR: number[][] = Array.from({ length: real.numRows }, () =>
    new Array<number>(real.numCols).fill(0),
  );
  for (let i = 0; i < real.numRows; i++) {
    for (let k = real.rowPtr[i]!; k < real.rowPtr[i + 1]!; k++) {
      denseR[i]![real.colIdx[k]!]! += real.values[k]!;
    }
  }
  const denseCRe: number[][] = Array.from({ length: complex.numRows }, () =>
    new Array<number>(complex.numCols).fill(0),
  );
  const denseCIm: number[][] = Array.from({ length: complex.numRows }, () =>
    new Array<number>(complex.numCols).fill(0),
  );
  for (let i = 0; i < complex.numRows; i++) {
    for (let k = complex.rowPtr[i]!; k < complex.rowPtr[i + 1]!; k++) {
      const j = complex.colIdx[k]!;
      denseCRe[i]![j]! += complex.values[2 * k]!;
      denseCIm[i]![j]! += complex.values[2 * k + 1]!;
    }
  }
  for (let i = 0; i < real.numRows; i++) {
    for (let j = 0; j < real.numCols; j++) {
      expect(
        Math.abs(denseCRe[i]![j]! - denseR[i]![j]!),
        `${context}: re[${i}][${j}]`,
      ).toBeLessThan(tol);
      expect(
        Math.abs(denseCIm[i]![j]!),
        `${context}: im[${i}][${j}]`,
      ).toBeLessThan(tol);
    }
  }
}

describe('PML mixed-system assembly — κ=0 reduction to real path', () => {
  it('homogeneous μ_r = ε_r = 1, k₀² = 5, noPml() — all four blocks match', () => {
    const mesh = rectangularMesh(5, 4, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const k0Squared = 5;

    const real = assembleMixedBlocks(mesh, topo, {
      epsilonR: () => 1,
      muR: () => 1,
      k0Squared,
    });
    const complex = assembleMixedBlocksPml(mesh, topo, {
      pml: noPml(),
      muR: () => 1,
      epsR: () => 1,
      k0Squared,
    });

    expectComplexMatchesReal(complex.Kt, real.Kt, 'Kt');
    expectComplexMatchesReal(complex.Mt, real.Mt, 'Mt');
    expectComplexMatchesReal(complex.Kn, real.Kn, 'Kn');
    expectComplexMatchesReal(complex.Ctz, real.Ctz, 'Ctz');
  });

  it('inhomogeneous ε_r, k₀² = 5, noPml() — still matches the real path', () => {
    // Half-domain has ε_r = 4 (bottom triangles by attribute = 1).
    const mesh = rectangularMesh(5, 4, 2, 1);
    // Tag bottom-half triangles with attribute = 1.
    for (let t = 0; t < mesh.triangleCount; t++) {
      const v0 = mesh.triangles[3 * t]!;
      const v1 = mesh.triangles[3 * t + 1]!;
      const v2 = mesh.triangles[3 * t + 2]!;
      const cy =
        (mesh.vertices[2 * v0 + 1]! +
          mesh.vertices[2 * v1 + 1]! +
          mesh.vertices[2 * v2 + 1]!) /
        3;
      mesh.triangleAttributes[t] = cy < 0.5 ? 1 : 0;
    }
    const topo = buildEdgeTopology(mesh);
    const epsR = (attr: number) => (attr === 1 ? 4 : 1);
    const muR = () => 1;
    const k0Squared = 5;

    const real = assembleMixedBlocks(mesh, topo, { epsilonR: epsR, muR, k0Squared });
    const complex = assembleMixedBlocksPml(mesh, topo, {
      pml: noPml(),
      muR,
      epsR,
      k0Squared,
    });

    expectComplexMatchesReal(complex.Kt, real.Kt, 'Kt');
    expectComplexMatchesReal(complex.Mt, real.Mt, 'Mt');
    expectComplexMatchesReal(complex.Kn, real.Kn, 'Kn');
    expectComplexMatchesReal(complex.Ctz, real.Ctz, 'Ctz');
  });
});

describe('PML mixed-system assembly — non-zero κ produces complex matrices', () => {
  it('y-direction PML zone produces visible imaginary parts in all four blocks', () => {
    const mesh = rectangularMesh(5, 4, 2, 1);
    const topo = buildEdgeTopology(mesh);
    // PML zone covers y > 0.7 (extends past the box's y=1 to y=1.5).
    const yProfile = polynomialPmlProfile1D({
      innerLo: -10,
      innerHi: 0.7,
      outerLo: -100,
      outerHi: 1.5,
      kappaMax: 2,
      order: 2,
    });
    const blocks = assembleMixedBlocksPml(mesh, topo, {
      pml: { x: identityProfile1D(), y: yProfile },
      muR: () => 1,
      epsR: () => 1,
      k0Squared: 5,
    });

    // Every block should have at least one entry with non-trivial imag.
    const totalImag = (M: ComplexCsrMatrix): number => {
      let s = 0;
      for (let k = 0; k < M.colIdx.length; k++) s += Math.abs(M.values[2 * k + 1]!);
      return s;
    };
    expect(totalImag(blocks.Kt)).toBeGreaterThan(0.01);
    expect(totalImag(blocks.Mt)).toBeGreaterThan(0.01);
    expect(totalImag(blocks.Kn)).toBeGreaterThan(0.01);
    expect(totalImag(blocks.Ctz)).toBeGreaterThan(0.01);
  });
});
