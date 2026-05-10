/**
 * Complex / anisotropic P1-nodal scalar assembly for the PML path
 * (Round 8c Stage 3a-v-a).
 *
 * Companion to `complex-vector-assembly.ts`. The mixed (E_t, E_z)
 * eigenvalue system has *two* scalar blocks living on the nodal
 * Lagrange space:
 *
 *   - K_grad-like:  ∫ ∇φ_i · α(x, y) · ∇φ_j dA          (anisotropic)
 *   - M_eps-like:   ∫ γ(x, y) · φ_i · φ_j dA            (scalar)
 *
 * With SC-PML, both pick up complex stretching factors. The
 * stiffness gets a 2×2 diagonal tensor `α = (1/μ_r) · diag(s_y/s_x,
 * s_x/s_y)`; the mass gets a scalar `γ = ε_r · s_x · s_y`. (Compared
 * to the un-stretched case, the s_x, s_y land on opposite places
 * versus the edge-DoF curl-curl / mass — this falls out of the
 * effective-tensor algebra; see `pml.ts` for the derivation.)
 *
 * Like `complex-vector-assembly.ts`, this module is a parallel API,
 * not a generalisation of the existing real `assembly.ts` — the real
 * path stays untouched so the homogeneous / dielectric-loaded
 * waveguide validations don't risk silent precision drift.
 */

import type { CsrMatrix } from '../fem/sparse';
import {
  ComplexCooBuilder,
  type ComplexCsrMatrix,
} from './complex-sparse';
import type {
  AnisoWeight,
  ComplexScalarWeight,
} from './complex-vector-assembly';
import type { Mesh } from '../types';

/**
 * Linear-T3 element data: shape-function gradients (b, c) and the
 * unsigned triangle area. Local copy to avoid pulling in
 * `assembly.ts` for one helper.
 */
interface T3Geometry {
  i0: number;
  i1: number;
  i2: number;
  area: number;
  bs: [number, number, number];
  cs: [number, number, number];
  cx: number;
  cy: number;
}

function triangleGeometry(mesh: Mesh, t: number): T3Geometry {
  const i0 = mesh.triangles[3 * t]!;
  const i1 = mesh.triangles[3 * t + 1]!;
  const i2 = mesh.triangles[3 * t + 2]!;
  const x0 = mesh.vertices[2 * i0]!;
  const y0 = mesh.vertices[2 * i0 + 1]!;
  const x1 = mesh.vertices[2 * i1]!;
  const y1 = mesh.vertices[2 * i1 + 1]!;
  const x2 = mesh.vertices[2 * i2]!;
  const y2 = mesh.vertices[2 * i2 + 1]!;
  const twoA = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const area = 0.5 * Math.abs(twoA);
  if (area === 0) {
    throw new Error(`triangleGeometry: degenerate triangle at index ${t}`);
  }
  const inv2A = 1 / twoA;
  return {
    i0,
    i1,
    i2,
    area,
    bs: [(y1 - y2) * inv2A, (y2 - y0) * inv2A, (y0 - y1) * inv2A],
    cs: [(x2 - x1) * inv2A, (x0 - x2) * inv2A, (x1 - x0) * inv2A],
    cx: (x0 + x1 + x2) / 3,
    cy: (y0 + y1 + y2) / 3,
  };
}

/**
 * Anisotropic stiffness:
 *
 *     K_{ij}  =  ∫_Ω  ∇φ_i · α(x, y) · ∇φ_j dA
 *
 * For diagonal α = diag(α_xx, α_yy):
 *     K^e_{ij}  =  area · (α_xx · b_i b_j  +  α_yy · c_i c_j)
 *
 * where (b_i, c_i) are the (constant) gradient components of φ_i.
 */
export function assembleScalarStiffnessAniso(
  mesh: Mesh,
  weight: AnisoWeight,
): ComplexCsrMatrix {
  const n = mesh.vertices.length / 2;
  const builder = new ComplexCooBuilder(n);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const { i0, i1, i2, area, bs, cs, cx, cy } = triangleGeometry(mesh, t);
    const alpha = weight(mesh.triangleAttributes[t]!, cx, cy);
    const idx: [number, number, number] = [i0, i1, i2];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const xxFactor = area * bs[r]! * bs[c]!;
        const yyFactor = area * cs[r]! * cs[c]!;
        const re = alpha.xx.re * xxFactor + alpha.yy.re * yyFactor;
        const im = alpha.xx.im * xxFactor + alpha.yy.im * yyFactor;
        builder.add(idx[r]!, idx[c]!, re, im);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Scalar-weight P1 mass:
 *
 *     M_{ij}  =  ∫_Ω  γ(x, y) · φ_i · φ_j dA
 *
 * Element matrix:
 *     M^e  =  (γ · area / 12) · [[2,1,1], [1,2,1], [1,1,2]]
 */
export function assembleScalarMassComplex(
  mesh: Mesh,
  weight: ComplexScalarWeight,
): ComplexCsrMatrix {
  const n = mesh.vertices.length / 2;
  const builder = new ComplexCooBuilder(n);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const { i0, i1, i2, area, cx, cy } = triangleGeometry(mesh, t);
    const gamma = weight(mesh.triangleAttributes[t]!, cx, cy);
    const baseRe = (gamma.re * area) / 12;
    const baseIm = (gamma.im * area) / 12;
    const idx: [number, number, number] = [i0, i1, i2];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const factor = r === c ? 2 : 1;
        builder.add(idx[r]!, idx[c]!, baseRe * factor, baseIm * factor);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Add two **complex** square CSR matrices linearly:
 *     C  =  α · A  +  β · B
 *
 * with complex scalar coefficients. Companion to
 * `combineSymmetric` in `mixed-assembly.ts` (which works on real
 * CSR). Used to fold `−k₀² M` into the stiffness block at assembly
 * time; here both `A` and `B` are complex, and `α`, `β` are real.
 *
 * Symmetry of the inputs is preserved (the operation is the same on
 * both axes).
 */
export function combineComplexSymmetric(
  A: ComplexCsrMatrix,
  alpha: number,
  B: ComplexCsrMatrix,
  beta: number,
): ComplexCsrMatrix {
  if (
    A.numRows !== A.numCols ||
    B.numRows !== B.numCols ||
    A.numRows !== B.numRows
  ) {
    throw new Error(
      `combineComplexSymmetric: shape mismatch (${A.numRows}×${A.numCols} vs ${B.numRows}×${B.numCols})`,
    );
  }
  const n = A.numRows;
  const builder = new ComplexCooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k++) {
      builder.add(
        i,
        A.colIdx[k]!,
        alpha * A.values[2 * k]!,
        alpha * A.values[2 * k + 1]!,
      );
    }
    for (let k = B.rowPtr[i]!; k < B.rowPtr[i + 1]!; k++) {
      builder.add(
        i,
        B.colIdx[k]!,
        beta * B.values[2 * k]!,
        beta * B.values[2 * k + 1]!,
      );
    }
  }
  return builder.toCsr();
}

// (Kept here to avoid a dependency cycle: mixed-pml-assembly.ts
// imports this module's combine helper alongside the matvec
// utilities.)
export type { CsrMatrix };
