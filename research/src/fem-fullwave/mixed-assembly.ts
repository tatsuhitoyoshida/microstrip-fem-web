/**
 * Mixed (E_t, E_z) block assembly for the vector-Helmholtz waveguide
 * eigenvalue problem (Round 8c Stage 2.5a).
 *
 * The weak form (derived directly from ∇ × (μ_r⁻¹ ∇ × E) = k₀² ε_r E
 * with `exp(−jβz)` propagation, properly conjugated test functions) is
 *
 *   ∫ μ_r⁻¹ (∇ × E_t)·(∇ × F_t)*  +  ∫ μ_r⁻¹ ∇E_z · ∇F_z*
 *   − k₀² [ ∫ ε_r E_t · F_t*  +  ∫ ε_r E_z F_z* ]
 *   − jβ ∫ μ_r⁻¹ (∇E_z · F_t* + E_t · ∇F_z*)
 *   = −β² ∫ μ_r⁻¹ E_t · F_t*
 *
 * This is **quadratic in β**. To make it a linear generalised
 * eigenvalue problem we split the system into edge / node blocks
 *
 *     (K_t − β² M_t) u  +  jβ C_tz v  =  0
 *     K_n v  +  jβ C_tz^T u            =  0
 *
 * (with `u = E_t`, `v = E_z` after restricting to free DoFs), eliminate
 * `v = −jβ K_n⁻¹ C_tz^T u` from the second row, and substitute back.
 * The `−jβ × −jβ = β²` collapse leaves a **linear** GEP on the edge
 * DoFs alone:
 *
 *     K_t u  =  β² (M_t − C_tz K_n⁻¹ C_tz^T) u   =:  β² M̃ u
 *
 * — see `schur.ts` for the M̃ assembly. This module assembles the four
 * constituent blocks once per (k₀, materials) tuple.
 *
 * Block definitions (with α = ε_r and γ = μ_r⁻¹ as per-triangle weights).
 * Note the **sign on K_t**: it's the *operator* form that lands β² with
 * the correct physical sign in the Schur GEP `K_t u = β² M̃ u`. From
 * the weak form,
 *
 *     ∫ μ_r⁻¹ (∇×E)·(∇×F)*  −  k₀² ∫ ε_r E·F*  =  0
 *
 * the β² term on the LHS has a **positive** sign (it falls out of the
 * cross-product expansion via −jβ × +jβ = +β²). Pushing it to the RHS
 * flips the LHS sign overall: the Schur reduction yields
 * `(−A_t) u = β² M̃ u`, where `A_t = K_curl − k₀² M_eps`. We bake the
 * negation into the assembly, so what we expose as `Kt` is in fact
 * `k₀² M_eps − K_curl`. With that convention, `Kt u = β² M̃ u` is the
 * eigenvalue equation the shift-invert solver consumes directly, and
 * for the homogeneous TE_10 test we recover `β² = k₀² − k_c²` (positive
 * for propagating modes).
 *
 *     K_t  [edge×edge] =  k₀² M_eps(α)  −  K_curl(γ)        (real symm)
 *     M_t  [edge×edge] =  M_invmu(γ)                         (real symm SPD)
 *     K_n  [node×node] =  K_grad(γ)  −  k₀² M_eps_n(α)       (real symm)
 *     C_tz [edge×node] =  ∫ γ N_e · ∇φ_n dA                  (real, rectangular)
 *
 * `K_n` is SPD as long as `k₀²` sits below the smallest scalar
 * Helmholtz Dirichlet eigenvalue on the same mesh (≈ TM-cutoff in
 * homogeneous boxes). Above that, K_n turns indefinite and the inner
 * Schur solve has to fall back to MINRES — but that's a Stage 2.5b
 * concern.
 */

import type { Mesh } from '../../../src/types';
import type { EdgeTopology } from './edge-dofs';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
  assembleEdgeNodeCoupling,
} from './vector-assembly';
import { assembleStiffness, assembleMass, type TriangleWeight } from './assembly';
import { CooBuilder, type CsrMatrix } from '../../../src/fem/sparse';

export interface MixedBlocks {
  /** Edge-edge: k₀² M_eps(ε_r) − K_curl(μ_r⁻¹). Real symmetric. The
   *  negation (vs. the more obvious K_curl − k₀² M) is what makes the
   *  Schur GEP `Kt u = β² M̃ u` give β² with the physical sign — see
   *  the file header. */
  Kt: CsrMatrix;
  /** Edge-edge: M_invmu(μ_r⁻¹). Real symmetric, SPD when μ_r > 0. */
  Mt: CsrMatrix;
  /** Node-node: K_grad(μ_r⁻¹) − k₀² M_eps(ε_r). Real symmetric. */
  Kn: CsrMatrix;
  /** Edge×node coupling: ∫ μ_r⁻¹ N_e · ∇φ_n dA. */
  Ctz: CsrMatrix;
}

export interface MixedAssemblyOptions {
  /** ε_r per triangle. */
  epsilonR: TriangleWeight;
  /** μ_r per triangle. */
  muR: TriangleWeight;
  /** k₀² = ω² ε₀ μ₀, the operating-frequency parameter. */
  k0Squared: number;
}

/**
 * Build C = α · A + β · B for two square matrices of the same size.
 * Both must have identical shape; symmetry of the inputs is preserved
 * (the operation is the same on both axes). Used here to fold the
 * `−k₀² M` shift into the stiffness block once at assembly time.
 */
function combineSymmetric(
  A: CsrMatrix,
  alpha: number,
  B: CsrMatrix,
  beta: number,
): CsrMatrix {
  if (A.numRows !== A.numCols || B.numRows !== B.numCols || A.numRows !== B.numRows) {
    throw new Error(
      `combineSymmetric: shape mismatch (${A.numRows}×${A.numCols} vs ${B.numRows}×${B.numCols})`,
    );
  }
  const n = A.numRows;
  const builder = new CooBuilder(n);
  for (let i = 0; i < n; i++) {
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k++) {
      builder.add(i, A.colIdx[k]!, alpha * A.values[k]!);
    }
    for (let k = B.rowPtr[i]!; k < B.rowPtr[i + 1]!; k++) {
      builder.add(i, B.colIdx[k]!, beta * B.values[k]!);
    }
  }
  return builder.toCsr();
}

/**
 * Assemble the four constituent blocks of the mixed (E_t, E_z) waveguide
 * eigenvalue problem at a given operating frequency `k₀²`.
 *
 * Cost: roughly the same as assembling K_curl + M_t + K_grad + M_n + C_tz
 * separately (one pass per block). The total is dominated by the edge
 * routines on FEM meshes.
 */
export function assembleMixedBlocks(
  mesh: Mesh,
  topology: EdgeTopology,
  options: MixedAssemblyOptions,
): MixedBlocks {
  const { epsilonR, muR, k0Squared } = options;
  const muRInverse: TriangleWeight = (attr) => 1 / muR(attr);

  const Kcurl = assembleEdgeCurlCurl(mesh, topology, muRInverse);
  const MepsEdge = assembleEdgeMass(mesh, topology, epsilonR);
  const Mt = assembleEdgeMass(mesh, topology, muRInverse);
  // Kt = k₀² M_eps − K_curl (note the sign — see header).
  const Kt = combineSymmetric(MepsEdge, k0Squared, Kcurl, -1);

  const Kgrad = assembleStiffness(mesh, muRInverse);
  const MepsNode = assembleMass(mesh, epsilonR);
  const Kn = combineSymmetric(Kgrad, 1, MepsNode, -k0Squared);

  const Ctz = assembleEdgeNodeCoupling(mesh, topology, muRInverse);

  return { Kt, Mt, Kn, Ctz };
}
