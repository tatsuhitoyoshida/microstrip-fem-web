/**
 * Complex / anisotropic edge-DoF assembly for the PML path
 * (Round 8c Stage 3a-iii).
 *
 * Why a parallel module instead of generalising the existing one:
 * the homogeneous and dielectric-loaded waveguide validations
 * (Stages 2.4 / 2.5 / 2.6) all run through `vector-assembly.ts` with
 * **real isotropic** weights, and they're our tightest numerical
 * regression bar. Punching the existing API to thread complex
 * tensors through every call site would risk silent precision /
 * symmetry drift on those tests for no benefit on the non-PML path.
 *
 * Instead this module exposes a parallel three-routine API matched
 * 1:1 to `vector-assembly.ts` but with complex anisotropic inputs:
 *
 *   - curl-curl weight is a **complex scalar** (the zz-component of
 *     the inverse μ tensor; in 2D the curl is z-only so only that
 *     component matters);
 *   - vector mass weight is a **2-D diagonal tensor** (the in-plane
 *     ε components ε_xx, ε_yy);
 *   - edge-node coupling weight is the same 2-D diagonal tensor,
 *     since the coupling integrand `N_e · α · ∇φ_n` is in-plane.
 *
 * Off-diagonal tensor entries (α_xy ≠ 0) don't appear in standard
 * SC-PML for axis-aligned absorbing layers, so we deliberately don't
 * support them yet — adding them would double the per-element FLOP
 * count and isn't motivated by the geometry we care about.
 *
 * Convention:
 *   - For an SC-PML region stretched in x with rate `s_x = 1 − jσ_x/ω`
 *     (and `s_y = 1` outside, `s_x = 1` outside), the effective
 *     material tensors fall out as:
 *
 *         curl-curl scalar  =  1 / (μ_r · s_x · s_y)
 *         mass tensor       =  ε_r · diag(s_y/s_x,  s_x/s_y)
 *         coupling tensor   =  μ_r⁻¹ · diag(s_y/s_x,  s_x/s_y)
 *
 *     `mixed-assembly.ts` (Stage 3a-v) will materialise these from a
 *     PML profile; this module just consumes whatever a caller hands
 *     it, isotropic or anisotropic.
 */

import type { Mesh } from '../types';
import type { EdgeTopology } from './edge-dofs';
import {
  ComplexCooBuilder,
  type Complex,
  type ComplexCsrMatrix,
} from './complex-sparse';
import { edgeCurl, triangleGeom } from './nedelec';

/** Complex-valued 2×2 diagonal tensor (xx, yy). Off-diagonals are zero. */
export interface DiagTensor2D {
  xx: Complex;
  yy: Complex;
}

export type ComplexScalarWeight = (regionAttr: number) => Complex;
export type AnisoWeight = (regionAttr: number) => DiagTensor2D;

/** Pull (x, y) for vertex `i` out of the flat `vertices` array. */
function vertexXY(mesh: Mesh, i: number): [number, number] {
  return [mesh.vertices[2 * i]!, mesh.vertices[2 * i + 1]!];
}

/**
 * Edge-DoF curl-curl stiffness with a per-region **complex scalar**
 * weight γ:
 *
 *     K_{ij}  =  ∫_Ω γ(x, y) · (∇×N_i) · (∇×N_j) dA
 *
 * In 2-D the curl is z-only, so γ here is the zz-component of the
 * inverse μ tensor. For SC-PML, γ = 1 / (μ_r s_x s_y).
 *
 * Symmetric (assuming γ is region-constant per triangle).
 */
export function assembleEdgeCurlCurlComplex(
  mesh: Mesh,
  topology: EdgeTopology,
  weight: ComplexScalarWeight,
): ComplexCsrMatrix {
  const builder = new ComplexCooBuilder(topology.numEdges);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const [x0, y0] = vertexXY(mesh, v0);
    const [x1, y1] = vertexXY(mesh, v1);
    const [x2, y2] = vertexXY(mesh, v2);
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);

    const c0 = edgeCurl(geom, 0);
    const c1 = edgeCurl(geom, 1);
    const c2 = edgeCurl(geom, 2);
    const cs: [number, number, number] = [c0, c1, c2];
    const area = geom.area;
    const gamma = weight(mesh.triangleAttributes[t]!);

    for (let r = 0; r < 3; r++) {
      const er = topology.tri2edge[3 * t + r]!;
      const sr = topology.tri2edgeSign[3 * t + r]!;
      for (let c = 0; c < 3; c++) {
        const ec = topology.tri2edge[3 * t + c]!;
        const sc = topology.tri2edgeSign[3 * t + c]!;
        const realFactor = sr * sc * cs[r]! * cs[c]! * area;
        builder.add(er, ec, gamma.re * realFactor, gamma.im * realFactor);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Element-level vector mass with **anisotropic diagonal** weight α.
 * Returns the 3×3 complex per-element matrix
 *
 *     M^e_{kl}  =  ∫_T  N_k · α · N_l dA
 *
 * For α = diag(α_xx, α_yy), the integrand splits cleanly into
 * x-component and y-component pieces because the gradient products
 * factor into bs (=∂λ/∂x) and cs (=∂λ/∂y) separately. Pulled out as
 * its own helper so the global routine below can keep its loop body
 * legible.
 */
function elementVectorMassAniso(
  geom: ReturnType<typeof triangleGeom>,
  alpha: DiagTensor2D,
): Complex[][] {
  const A = geom.area;
  // ∫_T λ_i λ_j dA on a linear triangle.
  const I = (i: number, j: number): number => (i === j ? A / 6 : A / 12);
  // Anisotropic gradient inner product: α_xx ∂_x ∂_x + α_yy ∂_y ∂_y.
  const dotAniso = (i: number, j: number): Complex => {
    const xxFactor = geom.bs[i]! * geom.bs[j]!;
    const yyFactor = geom.cs[i]! * geom.cs[j]!;
    return {
      re: alpha.xx.re * xxFactor + alpha.yy.re * yyFactor,
      im: alpha.xx.im * xxFactor + alpha.yy.im * yyFactor,
    };
  };
  // For local edge k, N_k = λ_a ∇λ_b − λ_b ∇λ_a with (a, b) = (k+1, k+2) mod 3.
  const ab: [number, number][] = [
    [1, 2],
    [2, 0],
    [0, 1],
  ];
  const M: Complex[][] = [
    [
      { re: 0, im: 0 },
      { re: 0, im: 0 },
      { re: 0, im: 0 },
    ],
    [
      { re: 0, im: 0 },
      { re: 0, im: 0 },
      { re: 0, im: 0 },
    ],
    [
      { re: 0, im: 0 },
      { re: 0, im: 0 },
      { re: 0, im: 0 },
    ],
  ];
  for (let k = 0; k < 3; k++) {
    const [a, b] = ab[k]!;
    for (let l = 0; l < 3; l++) {
      const [c, d] = ab[l]!;
      // (λ_a ∇λ_b − λ_b ∇λ_a) · α · (λ_c ∇λ_d − λ_d ∇λ_c)
      //   = λ_a λ_c (∇λ_b · α · ∇λ_d) − λ_a λ_d (∇λ_b · α · ∇λ_c)
      //    − λ_b λ_c (∇λ_a · α · ∇λ_d) + λ_b λ_d (∇λ_a · α · ∇λ_c)
      const t1 = dotAniso(b, d);
      const t2 = dotAniso(b, c);
      const t3 = dotAniso(a, d);
      const t4 = dotAniso(a, c);
      const w1 = I(a, c);
      const w2 = I(a, d);
      const w3 = I(b, c);
      const w4 = I(b, d);
      M[k]![l] = {
        re: w1 * t1.re - w2 * t2.re - w3 * t3.re + w4 * t4.re,
        im: w1 * t1.im - w2 * t2.im - w3 * t3.im + w4 * t4.im,
      };
    }
  }
  return M;
}

/**
 * Edge-DoF vector mass with a per-region **diagonal complex tensor**
 * weight α:
 *
 *     M_{ij}  =  ∫_Ω  N_i · α(x, y) · N_j dA,
 *     α(x, y) = diag(α_xx, α_yy).
 *
 * For SC-PML, α = ε_r · diag(s_y/s_x, s_x/s_y).
 */
export function assembleEdgeMassAniso(
  mesh: Mesh,
  topology: EdgeTopology,
  weight: AnisoWeight,
): ComplexCsrMatrix {
  const builder = new ComplexCooBuilder(topology.numEdges);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const [x0, y0] = vertexXY(mesh, v0);
    const [x1, y1] = vertexXY(mesh, v1);
    const [x2, y2] = vertexXY(mesh, v2);
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);

    const alpha = weight(mesh.triangleAttributes[t]!);
    const Me = elementVectorMassAniso(geom, alpha);

    for (let r = 0; r < 3; r++) {
      const er = topology.tri2edge[3 * t + r]!;
      const sr = topology.tri2edgeSign[3 * t + r]!;
      for (let c = 0; c < 3; c++) {
        const ec = topology.tri2edge[3 * t + c]!;
        const sc = topology.tri2edgeSign[3 * t + c]!;
        const orient = sr * sc;
        const m = Me[r]![c]!;
        builder.add(er, ec, orient * m.re, orient * m.im);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Edge-node coupling with a per-region **diagonal complex tensor**
 * weight α:
 *
 *     C_{en}  =  ∫_Ω  N_e · α(x, y) · ∇φ_n dA.
 *
 * Same structural derivation as the real-valued
 * `assembleEdgeNodeCoupling`, with the isotropic dot replaced by
 * α_xx · ∂_x∂_x + α_yy · ∂_y∂_y.
 *
 * Output is rectangular: `numEdges × numNodes`.
 */
export function assembleEdgeNodeCouplingAniso(
  mesh: Mesh,
  topology: EdgeTopology,
  weight: AnisoWeight,
): ComplexCsrMatrix {
  const numNodes = mesh.vertices.length / 2;
  const builder = new ComplexCooBuilder(topology.numEdges, numNodes);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const verts: [number, number, number] = [v0, v1, v2];
    const [x0, y0] = vertexXY(mesh, v0);
    const [x1, y1] = vertexXY(mesh, v1);
    const [x2, y2] = vertexXY(mesh, v2);
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);

    const alpha = weight(mesh.triangleAttributes[t]!);
    const aThird = geom.area / 3;

    for (let k = 0; k < 3; k++) {
      const er = topology.tri2edge[3 * t + k]!;
      const sr = topology.tri2edgeSign[3 * t + k]!;
      const a = (k + 1) % 3;
      const b = (k + 2) % 3;
      const dbx = geom.bs[b]! - geom.bs[a]!;
      const dby = geom.cs[b]! - geom.cs[a]!;
      for (let l = 0; l < 3; l++) {
        const vl = verts[l]!;
        // (∇λ_b − ∇λ_a) · α · ∇λ_l for diagonal α
        const xxPart = dbx * geom.bs[l]!;
        const yyPart = dby * geom.cs[l]!;
        const gradDotRe = alpha.xx.re * xxPart + alpha.yy.re * yyPart;
        const gradDotIm = alpha.xx.im * xxPart + alpha.yy.im * yyPart;
        const orient = sr * aThird;
        builder.add(er, vl, orient * gradDotRe, orient * gradDotIm);
      }
    }
  }

  return builder.toCsr();
}
