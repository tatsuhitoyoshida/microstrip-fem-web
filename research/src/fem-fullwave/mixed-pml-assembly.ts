/**
 * Mixed (E_t, E_z) PML block assembly for the open-domain waveguide
 * eigenvalue problem (Round 8c Stage 3a-v-b).
 *
 * Companion to `mixed-assembly.ts`, structured 1:1 so call sites can
 * swap between the closed (real-isotropic) and open (complex-PML)
 * tracks by replacing the import. With `noPml()` (κ_max = 0
 * everywhere) the PML factories collapse to identity stretch
 * factors, the complex assembly reduces to the real path with
 * imaginary part zero, and the four returned blocks match
 * `assembleMixedBlocks` to FP precision. That's the regression
 * guarantee `mixed-pml-assembly.test.ts` exercises explicitly — it's
 * how we know the PML-aware machinery hasn't drifted relative to the
 * Stage 2.4 / 2.5 / 2.6 validations.
 *
 * Block definitions (parallel structure to `mixed-assembly.ts`, but
 * with PML-stretched effective tensors substituted everywhere):
 *
 *     K_t  [edge×edge] = k₀² · M_(ε̃,t) − K_(curl, 1/μ̃_zz)
 *     M_t  [edge×edge] = M_(1/μ̃_t)
 *     K_n  [node×node] = K_∇(1/μ̃_t) − k₀² · M_(ε̃_zz)
 *     C_tz [edge×node] = ∫ N_e · (1/μ̃)_t · ∇φ_n dA
 *
 * The "(1/μ̃)_t" blocks use the same in-plane diagonal tensor that
 * the M_t / K_∇ / C_tz integrands all naturally produce (see
 * `pml.ts` for the cross-product identity that makes them coincide):
 *
 *     (1/μ̃)_t  =  (1/μ_r) · diag(s_y/s_x, s_x/s_y).
 *
 * The "ε̃" blocks split between in-plane (edge ε mass) and zz (node
 * ε mass):
 *
 *     ε̃_t        =  ε_r · diag(s_y/s_x, s_x/s_y)
 *     ε̃_zz       =  ε_r · s_x · s_y
 *
 * The K_t sign convention (`k₀² M − K_curl`, *not* `K_curl − k₀² M`)
 * is inherited verbatim from `mixed-assembly.ts`, so the Schur GEP
 * `K_t u = β² M̃ u` lands β² with the physical sign.
 */

import type { Mesh } from '../../../src/types';
import type { EdgeTopology } from './edge-dofs';
import type { ComplexCsrMatrix } from './complex-sparse';
import {
  assembleEdgeCurlCurlComplex,
  assembleEdgeMassAniso,
  assembleEdgeNodeCouplingAniso,
} from './complex-vector-assembly';
import {
  assembleScalarMassComplex,
  assembleScalarStiffnessAniso,
  combineComplexSymmetric,
} from './complex-scalar-assembly';
import {
  pmlCouplingWeight,
  pmlCurlCurlWeight,
  pmlMassWeight,
  pmlNodeMassWeight,
  type PmlMaterials,
} from './pml';

export interface MixedBlocksPml {
  /** Edge-edge: k₀² · M_(ε̃,t) − K_(curl, 1/μ̃_zz). Complex symmetric. */
  Kt: ComplexCsrMatrix;
  /** Edge-edge: M_(1/μ̃_t). Complex symmetric, SPD-like in the bilinear
   *  sense for moderately small κ_max. */
  Mt: ComplexCsrMatrix;
  /** Node-node: K_∇(1/μ̃_t) − k₀² · M_(ε̃_zz). Complex symmetric. */
  Kn: ComplexCsrMatrix;
  /** Edge×node coupling. Rectangular: numEdges × numNodes. */
  Ctz: ComplexCsrMatrix;
}

export interface MixedPmlAssemblyOptions extends PmlMaterials {
  /** Operating frequency parameter k₀² = ω² ε₀ μ₀. */
  k0Squared: number;
}

/**
 * Assemble the four blocks of the PML-aware mixed (E_t, E_z) GEP at
 * a given (k₀², materials) tuple.
 *
 * Cost: roughly 1.5× the real `assembleMixedBlocks` per block, plus
 * the per-triangle PML weight evaluations (a handful of complex
 * multiplies). Storage is 2× because of the complex values arrays.
 * For closed-domain meshes (~few hundred edges) this is comfortably
 * sub-second.
 */
export function assembleMixedBlocksPml(
  mesh: Mesh,
  topology: EdgeTopology,
  options: MixedPmlAssemblyOptions,
): MixedBlocksPml {
  const { pml, muR, epsR, k0Squared } = options;
  const materials: PmlMaterials = { pml, muR, epsR };

  const Kcurl = assembleEdgeCurlCurlComplex(
    mesh,
    topology,
    pmlCurlCurlWeight(materials),
  );
  const MepsEdge = assembleEdgeMassAniso(
    mesh,
    topology,
    pmlMassWeight(materials),
  );
  const Mt = assembleEdgeMassAniso(
    mesh,
    topology,
    pmlCouplingWeight(materials),
  );
  // K_t = k₀² · M_eps,t − K_curl   (sign convention from mixed-assembly.ts)
  const Kt = combineComplexSymmetric(MepsEdge, k0Squared, Kcurl, -1);

  const Kgrad = assembleScalarStiffnessAniso(mesh, pmlCouplingWeight(materials));
  const MepsNode = assembleScalarMassComplex(mesh, pmlNodeMassWeight(materials));
  // K_n = K_∇ − k₀² · M_eps,n
  const Kn = combineComplexSymmetric(Kgrad, 1, MepsNode, -k0Squared);

  const Ctz = assembleEdgeNodeCouplingAniso(
    mesh,
    topology,
    pmlCouplingWeight(materials),
  );

  return { Kt, Mt, Kn, Ctz };
}
