/**
 * P1 nodal Lagrange assembly for the scalar-Helmholtz formulation
 * (Round 8b, case A).
 *
 * The TE-z Helmholtz equation on an inhomogeneous cross-section
 *
 *   ∇_t · (α ∇_t H_z)  +  γ H_z  =  β² δ H_z
 *
 * (with α, γ, δ region-dependent functions of εr) discretises into a
 * generalised eigenvalue problem of the form
 *
 *   (K_α  − k₀² M_γ)  h  =  β²  M_δ  h
 *
 * — i.e. it boils down to assembling **stiffness** (∫ α ∇v·∇u dA) and
 * **mass** (∫ α v u dA) matrices, both with arbitrary per-triangle
 * weight α. This module exposes a single weight-aware helper for each
 * so the Helmholtz layer above can plug in 1, εr, εr⁻¹ etc. without
 * touching the assembly loop.
 *
 * Quasi-static `src/fem/assembly.ts` does the same work for a single
 * εr-weighted stiffness — kept separate to avoid breaking that
 * regression-tested entry point. The two share the linear-T3 shape
 * functions and the COO/CSR sparse infrastructure.
 *
 * Reference:
 *   J. Jin, "The Finite Element Method in Electromagnetics," 3rd ed.,
 *   §3.4 (P1 element matrices on triangles).
 */

import { CooBuilder, type CsrMatrix } from '../../../src/fem/sparse';
import type { Mesh } from '../../../src/types';

/**
 * Per-triangle scalar weight. The caller decides how to interpret the
 * `regionAttr` integer (e.g. substrate vs air). Returning 1 reproduces
 * the unweighted Laplacian / mass matrices.
 */
export type TriangleWeight = (regionAttr: number) => number;

/**
 * Linear-T3 element data: shape-function gradients (b, c) and the signed
 * triangle area. Shared between stiffness and mass assembly so we only
 * walk the triangle list once per matrix.
 */
interface T3Geometry {
  i0: number;
  i1: number;
  i2: number;
  area: number;
  bs: [number, number, number];
  cs: [number, number, number];
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
  };
}

/**
 * Assemble the weighted stiffness matrix
 *
 *     K_{ij}  =  ∫_Ω α(x,y) ∇φ_i · ∇φ_j dA
 *
 * where α is constant on each triangle (provided by `weight`). The
 * resulting CSR matrix is symmetric. For unweighted Laplacian, pass
 * `() => 1`.
 */
export function assembleStiffness(mesh: Mesh, weight: TriangleWeight): CsrMatrix {
  const n = mesh.vertices.length / 2;
  const builder = new CooBuilder(n);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const { i0, i1, i2, area, bs, cs } = triangleGeometry(mesh, t);
    const alpha = weight(mesh.triangleAttributes[t]!);
    const factor = alpha * area;
    const idx: [number, number, number] = [i0, i1, i2];

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const k = factor * (bs[r]! * bs[c]! + cs[r]! * cs[c]!);
        builder.add(idx[r]!, idx[c]!, k);
      }
    }
  }

  return builder.toCsr();
}

/**
 * Assemble the weighted mass matrix
 *
 *     M_{ij}  =  ∫_Ω α(x,y) φ_i · φ_j dA
 *
 * Linear T3 element matrix:
 *
 *     M^e  =  (α_e · A_e / 12)  ·  | 2  1  1 |
 *                                  | 1  2  1 |
 *                                  | 1  1  2 |
 */
export function assembleMass(mesh: Mesh, weight: TriangleWeight): CsrMatrix {
  const n = mesh.vertices.length / 2;
  const builder = new CooBuilder(n);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const { i0, i1, i2, area } = triangleGeometry(mesh, t);
    const alpha = weight(mesh.triangleAttributes[t]!);
    const base = (alpha * area) / 12;
    const idx: [number, number, number] = [i0, i1, i2];

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const m = base * (r === c ? 2 : 1);
        builder.add(idx[r]!, idx[c]!, m);
      }
    }
  }

  return builder.toCsr();
}
