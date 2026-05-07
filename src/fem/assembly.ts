/**
 * Element-by-element FEM assembly for the 2-D microstrip electrostatics
 * problem. Discretises the weak form
 *
 *   ∫_Ω εr ∇φ · ∇v dA = 0,        ∀ v ∈ H¹₀(Ω)
 *
 * with linear three-node triangular (T3) elements. Each element contributes
 * a 3×3 stiffness block:
 *
 *   K^e_{ij} = εr_e · A_e · (b_i b_j + c_i c_j)
 *
 * where A_e is the triangle area and b_i, c_i are the constant gradients of
 * the three barycentric shape functions.
 *
 * The result is a global symmetric positive-definite (after BC) sparse K in
 * dimensionless form (no ε₀ factor — multiply by ε₀ when converting energy
 * to physical capacitance).
 */

import { CooBuilder, type CsrMatrix } from './sparse';
import type { Mesh } from '../types';

/** Map a region attribute (e.g. RegionAttr.Substrate) to its εr value. */
export type EpsilonRForRegion = (regionAttr: number) => number;

/**
 * Assemble the global stiffness matrix K for the supplied mesh.
 *
 * The εr lookup is callback-driven so callers can decide how to handle
 * unknown regions (e.g. throw vs. default to 1).
 */
export function assembleK(mesh: Mesh, epsilonRForRegion: EpsilonRForRegion): CsrMatrix {
  const n = mesh.vertices.length / 2;
  const nTri = mesh.triangleCount;
  const builder = new CooBuilder(n);

  for (let t = 0; t < nTri; t++) {
    const i0 = mesh.triangles[3 * t]!;
    const i1 = mesh.triangles[3 * t + 1]!;
    const i2 = mesh.triangles[3 * t + 2]!;

    const x0 = mesh.vertices[2 * i0]!;
    const y0 = mesh.vertices[2 * i0 + 1]!;
    const x1 = mesh.vertices[2 * i1]!;
    const y1 = mesh.vertices[2 * i1 + 1]!;
    const x2 = mesh.vertices[2 * i2]!;
    const y2 = mesh.vertices[2 * i2 + 1]!;

    // Twice the signed area; positive when (i0,i1,i2) is counter-clockwise.
    const twoA = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const area = 0.5 * Math.abs(twoA);
    if (area === 0) {
      throw new Error(`assembleK: degenerate triangle at index ${t}`);
    }

    // Shape-function gradients (constant on T3):  b_i = (y_j - y_k)/(2A)
    //                                             c_i = (x_k - x_j)/(2A)
    const inv2A = 1 / twoA;
    const b0 = (y1 - y2) * inv2A;
    const b1 = (y2 - y0) * inv2A;
    const b2 = (y0 - y1) * inv2A;
    const c0 = (x2 - x1) * inv2A;
    const c1 = (x0 - x2) * inv2A;
    const c2 = (x1 - x0) * inv2A;

    const epsR = epsilonRForRegion(mesh.triangleAttributes[t]!);
    const factor = epsR * area;

    const idx: [number, number, number] = [i0, i1, i2];
    const bs = [b0, b1, b2];
    const cs = [c0, c1, c2];

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const k = factor * (bs[r]! * bs[c]! + cs[r]! * cs[c]!);
        builder.add(idx[r]!, idx[c]!, k);
      }
    }
  }

  return builder.toCsr();
}
