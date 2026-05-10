/**
 * End-to-end PML eigensolver wrapper (Round 8c Stage 3a-vi-a).
 *
 * Bundles the full PML pipeline behind a single call:
 *
 *     assembleMixedBlocksPml             — complex 4-block GEP
 *     PEC restriction (edges + nodes)    — drop boundary DoFs
 *     assembleSchurMassComplex            — M̃ via complex BiCGStab
 *     buildGradientDeflatorComplex       — M-orthogonal projector
 *     shiftInvertEigenvalueComplex        — β² closest to σ
 *
 * Use cases:
 *
 *   - Closed PEC waveguide regression (κ = 0): runs through the PML
 *     stack but returns the same eigenvalue as the real path (the
 *     Stage 3a-v-c-3 test exercises this).
 *
 *   - Open microstrip with a PML truncation: same call, but with a
 *     non-trivial `pml` config and a meaningful `shift` (typically
 *     `k₀² · ε_eff_quasi_static` to lock onto the dominant
 *     quasi-TEM mode).
 *
 * The wrapper *also* recovers the E_z (node) component of the
 * eigenvector after the eigenvalue is found. Schur reduction
 * eliminated E_z to land β² as a linear GEP in E_t alone, but
 * downstream Z₀ extraction needs both halves; one extra inner solve
 * gets the rest.
 */

import type { Mesh } from '../../../src/types';
import type { EdgeTopology } from './edge-dofs';
import {
  partitionDirichlet,
  restrictRect,
  restrictRectComplex,
  restrictToFreeComplex,
  type DirichletPartition,
} from './boundary';
import { findPecEdges } from './edge-dofs';
import {
  assembleMixedBlocksPml,
  type MixedBlocksPml,
} from './mixed-pml-assembly';
import { assembleSchurMassComplex } from './complex-schur';
import {
  assembleDiscreteGradient,
} from './gradient';
import { buildGradientDeflatorComplex } from './complex-gradient';
import {
  shiftInvertEigenvalueComplex,
  type ComplexGradientDeflator,
} from './complex-eigsolve';
import { solveCBicgstab } from './complex-solver';
import {
  caxpy,
  cspmv,
  cspmvT,
  type Complex,
  type ComplexCsrMatrix,
} from './complex-sparse';
import type { Pml2D, RealRegionWeight } from './pml';

export interface PmlEigensolveOptions {
  /** ε_r per region attribute. */
  epsilonR: RealRegionWeight;
  /** μ_r per region attribute. */
  muR: RealRegionWeight;
  /** PML configuration. Use `noPml()` for closed-domain regression. */
  pml: Pml2D;
  /** Operating frequency parameter k₀² = ω² ε₀ μ₀, in the same length
   *  units as the mesh (mm-based: k₀² is in 1/mm²). */
  k0Squared: number;
  /** Complex shift σ. The recovered β² is the eigenvalue closest to σ
   *  in absolute distance; for the dominant quasi-TEM mode, choose
   *  `σ ≈ k₀² · ε_eff_quasi_static` (real). */
  shift: Complex;
  /** Predicate identifying PEC vertex markers. True → drop both edge
   *  DoFs (when both endpoints PEC) and node DoFs. */
  isPecMarker: (marker: number) => boolean;
  /** Inner BiCGStab tolerance for Schur / deflator / shift-invert
   *  solves. Default 1e-10. */
  innerTol?: number;
  /** Outer eigenvalue convergence tolerance. Default 1e-8. */
  outerTol?: number;
  /** Outer eigenvalue iteration cap. Default 200. */
  outerMaxIter?: number;
  /** Inner Bi-CGSTAB iteration cap inside the shift-invert outer
   *  loop. Falls back to BiCGStab's default (4·n) when omitted. */
  innerMaxIter?: number;
  /** When true, recover the E_z (node) component of the eigenvector
   *  via one extra inner solve. Default true. */
  recoverEz?: boolean;
}

export interface PmlEigensolveResult {
  /** Recovered β² (complex; imag part = radiation loss / numerical
   *  drift). */
  beta2: Complex;
  /** Eigenvector E_t component on the *free* edge DoFs (length
   *  2 · numFreeEdges, interleaved complex). */
  eFreeEdges: Float64Array;
  /** Eigenvector E_z component on the *free* node DoFs, recovered as
   *  v = −j β · K_n⁻¹ · C_tzᵀ · u. Length 2 · numFreeNodes. Empty
   *  array if `recoverEz === false`. */
  eFreeNodes: Float64Array;
  /** Free-edge / free-node partitions for downstream scatter back to
   *  full DoFs. */
  edgePartition: DirichletPartition;
  nodePartition: DirichletPartition;
  /** Diagnostics. */
  outerIterations: number;
  innerIterations: number;
  converged: boolean;
}

/**
 * Solve the PML mixed-system eigenvalue problem on a meshed
 * cross-section.
 *
 * The `mesh` must already carry per-triangle region attributes (used
 * by `epsilonR` / `muR`) and per-vertex markers (used by
 * `isPecMarker`). For microstrip-style geometries that's exactly what
 * `buildMicrostripPslg` + triangle-wasm produce.
 */
export function solveMixedSystemPml(
  mesh: Mesh,
  topology: EdgeTopology,
  options: PmlEigensolveOptions,
): PmlEigensolveResult {
  const numNodes = mesh.vertices.length / 2;
  const innerTol = options.innerTol ?? 1e-10;
  const outerTol = options.outerTol ?? 1e-8;
  const outerMaxIter = options.outerMaxIter ?? 200;
  const recoverEz = options.recoverEz ?? true;

  // 1. Assemble the four PML blocks.
  const blocks: MixedBlocksPml = assembleMixedBlocksPml(mesh, topology, {
    pml: options.pml,
    muR: options.muR,
    epsR: options.epsilonR,
    k0Squared: options.k0Squared,
  });

  // 2. PEC partitioning.
  const pecEdges = findPecEdges(topology, mesh, options.isPecMarker);
  const edgePartition = partitionDirichlet(topology.numEdges, pecEdges);
  const pecNodes: number[] = [];
  for (let n = 0; n < numNodes; n++) {
    if (options.isPecMarker(mesh.vertexMarkers[n]!)) pecNodes.push(n);
  }
  const nodePartition = partitionDirichlet(numNodes, pecNodes);

  const KtFree = restrictToFreeComplex(blocks.Kt, edgePartition);
  const MtFree = restrictToFreeComplex(blocks.Mt, edgePartition);
  const KnFree = restrictToFreeComplex(blocks.Kn, nodePartition);
  const CtzFree = restrictRectComplex(
    blocks.Ctz,
    edgePartition,
    nodePartition,
  );

  // 3. Schur-complement mass M̃.
  const tildeM = assembleSchurMassComplex(MtFree, CtzFree, KnFree, {
    innerTol,
  });

  // 4. Gradient deflator on the (free-edge × free-node) restricted
  // discrete-gradient operator.
  const G = assembleDiscreteGradient(topology, numNodes);
  const Gfree = restrictRect(G, edgePartition, nodePartition);
  const deflator: ComplexGradientDeflator = buildGradientDeflatorComplex(
    Gfree,
    MtFree,
    { pinnedNodes: [], innerTol },
  );

  // 5. Shift-invert outer iteration.
  const eigsolve = shiftInvertEigenvalueComplex(KtFree, tildeM, {
    shift: options.shift,
    deflator,
    tol: outerTol,
    maxIter: outerMaxIter,
    innerTol,
    ...(options.innerMaxIter !== undefined
      ? { innerMaxIter: options.innerMaxIter }
      : {}),
  });

  // 6. Recover E_z (free-node DoFs) from the converged β² and
  // eigenvector E_t. Schur reduction gave us
  //     v = −jβ · K_n⁻¹ · C_tzᵀ · u
  // so one more BiCGStab inner solve does it.
  let eFreeNodes = new Float64Array(0);
  if (recoverEz && eigsolve.converged) {
    const u = eigsolve.eigenvector;
    const Ctu = cspmvT(CtzFree, u); // length 2·numFreeNodes
    const inner = solveCBicgstab(KnFree, Ctu, { tol: innerTol });
    if (inner.converged) {
      // β = sqrt(β²) — choose the principal-root branch (re ≥ 0).
      const beta = complexSqrtPrincipal(eigsolve.eigenvalue);
      // v = −jβ · K_n⁻¹ · C_tzᵀ · u
      // We have K_n⁻¹·C_tzᵀ·u = inner.x. Multiply by −jβ.
      const negJBeta: Complex = { re: beta.im, im: -beta.re };
      const v = new Float64Array(inner.x.length);
      // Use caxpy on a zero base: v = 0 + (-jβ) · inner.x
      caxpy(negJBeta.re, negJBeta.im, inner.x, v);
      eFreeNodes = v;
    }
    // If E_z recovery fails we just leave it empty — the eigenvalue is
    // still useful for diagnostics.
  }

  return {
    beta2: eigsolve.eigenvalue,
    eFreeEdges: eigsolve.eigenvector,
    eFreeNodes,
    edgePartition,
    nodePartition,
    outerIterations: eigsolve.iterations,
    innerIterations: eigsolve.innerIterations,
    converged: eigsolve.converged,
  };
}

/**
 * Principal complex square root: the branch with non-negative real
 * part, falling back to non-negative imaginary part on the imaginary
 * axis. Used to recover β = √β² from the converged eigenvalue. The
 * choice of branch is conventional: physical propagating modes have
 * Re(β) > 0.
 */
function complexSqrtPrincipal(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im);
  // sqrt(r) · e^{jθ/2}
  const re = Math.sqrt((r + z.re) / 2);
  const imSign = z.im >= 0 ? 1 : -1;
  const im = imSign * Math.sqrt((r - z.re) / 2);
  return { re, im };
}

/**
 * Helper: multiply a complex CSR matvec to convert a free-DoF vector
 * back into the full DoF space (with zeros at the eliminated indices).
 * Re-export here so downstream Z₀ extraction can scatter without
 * pulling in `boundary.ts` directly.
 */
export function scatterFreeComplex(
  freeVec: Float64Array,
  partition: DirichletPartition,
): Float64Array {
  const fullSize = partition.freeOf.length;
  const out = new Float64Array(2 * fullSize);
  const nFree = partition.freeIndices.length;
  for (let j = 0; j < nFree; j++) {
    const fullIdx = partition.freeIndices[j]!;
    out[2 * fullIdx] = freeVec[2 * j]!;
    out[2 * fullIdx + 1] = freeVec[2 * j + 1]!;
  }
  return out;
}

// Re-exports kept here so callers don't need to know about the
// internal split between `pml.ts`, `complex-eigsolve.ts`, etc.
export type { ComplexCsrMatrix };
export { cspmv };
