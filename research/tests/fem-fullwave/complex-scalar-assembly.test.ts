// @vitest-environment node
/**
 * Complex / anisotropic P1 scalar assembly (Round 8c Stage 3a-v-a).
 *
 * Same playbook as the complex vector assembly tests:
 *
 *   1. **Reduction to real isotropic** — diag(α₀, α₀) with α₀ real
 *      gives the same stiffness as the existing `assembleStiffness`
 *      (with imag = 0); a real scalar weight gives the same mass as
 *      `assembleMass`.
 *
 *   2. **Anisotropy and complex content** are visible in the output
 *      when present.
 *
 *   3. **Symmetry** of the assembled matrices.
 *
 *   4. **`combineComplexSymmetric`** does what its real twin does on
 *      the real path (linear combination, preserves shape, preserves
 *      symmetry).
 */

import { describe, expect, it } from 'vitest';
import { assembleStiffness, assembleMass } from '../../src/fem-fullwave/assembly';
import {
  assembleScalarMassComplex,
  assembleScalarStiffnessAniso,
  combineComplexSymmetric,
} from '../../src/fem-fullwave/complex-scalar-assembly';
import { ComplexCooBuilder } from '../../src/fem-fullwave/complex-sparse';
import type { Mesh } from '../../../src/types';

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

function complexToDense(M: {
  numRows: number;
  numCols: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
}): { re: number[][]; im: number[][] } {
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

function realToDense(M: {
  numRows: number;
  numCols: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
}): number[][] {
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

describe('Complex scalar assembly — reduction to real isotropic', () => {
  it('stiffness with diag(α, α) real matches the real isotropic assembly', () => {
    const mesh = unitSquareMesh();
    const Kreal = assembleStiffness(mesh, () => 2.5);
    const Kc = assembleScalarStiffnessAniso(mesh, () => ({
      xx: { re: 2.5, im: 0 },
      yy: { re: 2.5, im: 0 },
    }));
    const dr = realToDense(Kreal);
    const dc = complexToDense(Kc);
    for (let i = 0; i < Kreal.numRows; i++) {
      for (let j = 0; j < Kreal.numCols; j++) {
        expect(dc.re[i]![j]).toBeCloseTo(dr[i]![j]!, 12);
        expect(dc.im[i]![j]).toBeCloseTo(0, 12);
      }
    }
  });

  it('scalar mass with γ real matches the real isotropic mass', () => {
    const mesh = unitSquareMesh();
    const Mreal = assembleMass(mesh, () => 1.7);
    const Mc = assembleScalarMassComplex(mesh, () => ({ re: 1.7, im: 0 }));
    const dr = realToDense(Mreal);
    const dc = complexToDense(Mc);
    for (let i = 0; i < Mreal.numRows; i++) {
      for (let j = 0; j < Mreal.numCols; j++) {
        expect(dc.re[i]![j]).toBeCloseTo(dr[i]![j]!, 12);
        expect(dc.im[i]![j]).toBeCloseTo(0, 12);
      }
    }
  });
});

describe('Complex scalar assembly — anisotropy / complex content', () => {
  it('αxx ≠ αyy gives a different stiffness than the isotropic average', () => {
    const mesh = unitSquareMesh();
    const Ka = assembleScalarStiffnessAniso(mesh, () => ({
      xx: { re: 1, im: 0 },
      yy: { re: 4, im: 0 },
    }));
    const Ki = assembleScalarStiffnessAniso(mesh, () => ({
      xx: { re: 2.5, im: 0 },
      yy: { re: 2.5, im: 0 },
    }));
    const da = complexToDense(Ka);
    const di = complexToDense(Ki);
    let maxDiff = 0;
    for (let i = 0; i < Ka.numRows; i++) {
      for (let j = 0; j < Ka.numCols; j++) {
        maxDiff = Math.max(maxDiff, Math.abs(da.re[i]![j]! - di.re[i]![j]!));
      }
    }
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('imaginary tensor entries propagate into the stiffness matrix', () => {
    const mesh = unitSquareMesh();
    const Kc = assembleScalarStiffnessAniso(mesh, () => ({
      xx: { re: 1, im: 0.3 },
      yy: { re: 1, im: -0.5 },
    }));
    const d = complexToDense(Kc);
    let imSum = 0;
    for (let i = 0; i < Kc.numRows; i++) {
      for (let j = 0; j < Kc.numCols; j++) {
        imSum += Math.abs(d.im[i]![j]!);
      }
    }
    expect(imSum).toBeGreaterThan(0.01);
  });

  it('imaginary scalar weight propagates into the mass matrix', () => {
    const mesh = unitSquareMesh();
    const Mc = assembleScalarMassComplex(mesh, () => ({ re: 1, im: -0.4 }));
    const d = complexToDense(Mc);
    let imSum = 0;
    for (let i = 0; i < Mc.numRows; i++) {
      for (let j = 0; j < Mc.numCols; j++) {
        imSum += Math.abs(d.im[i]![j]!);
      }
    }
    expect(imSum).toBeGreaterThan(0.01);
  });
});

describe('Complex scalar assembly — symmetry', () => {
  it('stiffness is complex symmetric for any diagonal tensor weight', () => {
    const mesh = unitSquareMesh();
    const K = assembleScalarStiffnessAniso(mesh, () => ({
      xx: { re: 1.2, im: -0.3 },
      yy: { re: 0.8, im: 0.4 },
    }));
    const d = complexToDense(K);
    for (let i = 0; i < K.numRows; i++) {
      for (let j = i + 1; j < K.numCols; j++) {
        expect(d.re[i]![j]).toBeCloseTo(d.re[j]![i]!, 12);
        expect(d.im[i]![j]).toBeCloseTo(d.im[j]![i]!, 12);
      }
    }
  });

  it('mass is complex symmetric for any complex scalar weight', () => {
    const mesh = unitSquareMesh();
    const M = assembleScalarMassComplex(mesh, () => ({ re: 0.7, im: 0.5 }));
    const d = complexToDense(M);
    for (let i = 0; i < M.numRows; i++) {
      for (let j = i + 1; j < M.numCols; j++) {
        expect(d.re[i]![j]).toBeCloseTo(d.re[j]![i]!, 12);
        expect(d.im[i]![j]).toBeCloseTo(d.im[j]![i]!, 12);
      }
    }
  });
});

describe('combineComplexSymmetric', () => {
  it('combines two complex CSRs with real coefficients', () => {
    // 2×2 simple example. A = [[1+j, 0], [0, 2]], B = I_2.
    // 2A − 3B = [[2(1+j) − 3, 0], [0, 4 − 3]] = [[−1 + 2j, 0], [0, 1]].
    const ba = new ComplexCooBuilder(2);
    ba.add(0, 0, 1, 1);
    ba.add(1, 1, 2, 0);
    const A = ba.toCsr();
    const bb = new ComplexCooBuilder(2);
    bb.add(0, 0, 1, 0);
    bb.add(1, 1, 1, 0);
    const B = bb.toCsr();
    const C = combineComplexSymmetric(A, 2, B, -3);
    const d = complexToDense(C);
    expect(d.re[0]![0]).toBeCloseTo(-1, 12);
    expect(d.im[0]![0]).toBeCloseTo(2, 12);
    expect(d.re[0]![1]).toBeCloseTo(0, 12);
    expect(d.im[0]![1]).toBeCloseTo(0, 12);
    expect(d.re[1]![0]).toBeCloseTo(0, 12);
    expect(d.im[1]![0]).toBeCloseTo(0, 12);
    expect(d.re[1]![1]).toBeCloseTo(1, 12);
    expect(d.im[1]![1]).toBeCloseTo(0, 12);
  });
});
