/**
 * Complex M-orthogonal gradient deflator (Round 8c Stage 3a-v-c-2).
 *
 * Direct port of `gradient.ts` for the PML path. The discrete
 * gradient operator G itself is **real** (entries ±1 from edge
 * incidence) and lives in the existing real `CsrMatrix` form; only
 * the metric M is complex (the PML-stretched edge-mass tensor). So
 * the projector solves a complex symmetric Laplacian:
 *
 *     L  =  Gᵀ M G    (complex symmetric, n_node × n_node)
 *     P_perp v  =  v  −  G · z,  L · z = Gᵀ · M · v
 *
 * with the inner solve handled by complex Bi-CGSTAB. M is allowed to
 * be indefinite in the PML zone (where the diag tensor entries can
 * land arbitrary complex values), so we don't assume L SPD; BiCGStab
 * absorbs the indefiniteness transparently.
 *
 * Why a parallel module rather than generalising `gradient.ts`: the
 * real path's L = G^T M G is built and inverted using the real Jacobi
 * PCG. Threading complex storage through that hot path would force
 * the closed-domain validations to consume complex throughout, which
 * we explicitly want to avoid.
 */

import { partitionDirichlet, restrictToFreeComplex, type DirichletPartition, scatterFreeToFull } from './boundary';
import {
  ComplexCooBuilder,
  type ComplexCsrMatrix,
  cspmv,
  cspmvT,
  realToComplexCsr,
} from './complex-sparse';
import type { ComplexGradientDeflator } from './complex-eigsolve';
import type { CsrMatrix } from '../fem/sparse';
import { solveCBicgstab } from './complex-solver';

export interface ComplexGradientDeflatorOptions {
  pinnedNodes?: Iterable<number>;
  /** Inner Bi-CGSTAB tolerance for the discrete-Laplacian solve.
   *  Default 1e-12. */
  innerTol?: number;
}

/**
 * Build L = Gᵀ · M · G as a complex CSR. G is real (so it's promoted
 * to complex storage with imag = 0); M is genuinely complex. Same
 * algorithm as `assembleNodalGramian` in `gradient.ts`, just with
 * complex multiplies.
 */
function assembleComplexNodalGramian(
  G: CsrMatrix,
  M: ComplexCsrMatrix,
): ComplexCsrMatrix {
  if (M.numRows !== G.numRows || M.numCols !== G.numRows) {
    throw new Error(
      `assembleComplexNodalGramian: M must be ${G.numRows}×${G.numRows}, got ${M.numRows}×${M.numCols}`,
    );
  }
  const numNodes = G.numCols;
  const builder = new ComplexCooBuilder(numNodes);
  for (let e1 = 0; e1 < M.numRows; e1++) {
    const g1Start = G.rowPtr[e1]!;
    const g1End = G.rowPtr[e1 + 1]!;
    for (let kM = M.rowPtr[e1]!; kM < M.rowPtr[e1 + 1]!; kM++) {
      const e2 = M.colIdx[kM]!;
      const mRe = M.values[2 * kM]!;
      const mIm = M.values[2 * kM + 1]!;
      const g2Start = G.rowPtr[e2]!;
      const g2End = G.rowPtr[e2 + 1]!;
      for (let k1 = g1Start; k1 < g1End; k1++) {
        const v1 = G.colIdx[k1]!;
        const g1 = G.values[k1]!;
        for (let k2 = g2Start; k2 < g2End; k2++) {
          const v2 = G.colIdx[k2]!;
          const g2 = G.values[k2]!;
          const w = g1 * g2; // real
          // Δ = w · M[e1, e2] (complex)
          builder.add(v1, v2, w * mRe, w * mIm);
        }
      }
    }
  }
  return builder.toCsr();
}

/**
 * Build the complex M-orthogonal projector onto the complement of the
 * gradient subspace. Same shape as `buildGradientDeflator` in
 * `gradient.ts`, with complex storage on the M-side and a complex
 * inner solve.
 */
export function buildGradientDeflatorComplex(
  G: CsrMatrix,
  M: ComplexCsrMatrix,
  options: ComplexGradientDeflatorOptions = {},
): ComplexGradientDeflator {
  const innerTol = options.innerTol ?? 1e-12;
  const numNodes = G.numCols;

  const L = assembleComplexNodalGramian(G, M);
  const pinned: Iterable<number> =
    options.pinnedNodes !== undefined ? options.pinnedNodes : [0];
  const partition: DirichletPartition = partitionDirichlet(numNodes, pinned);
  const Lfree = restrictToFreeComplex(L, partition);

  // Promote real G to complex once (used in the matvec path).
  const Gc = realToComplexCsr(G);

  return {
    project(v: Float64Array): Float64Array {
      if (v.length !== 2 * G.numRows) {
        throw new Error(
          `gradient deflator (complex): v has length ${v.length}, expected ${2 * G.numRows}`,
        );
      }
      // b = Gᵀ M v
      const Mv = cspmv(M, v);
      const b = cspmvT(Gc, Mv);
      // Restrict b to free nodes.
      const nFree = partition.freeIndices.length;
      const bFree = new Float64Array(2 * nFree);
      for (let j = 0; j < nFree; j++) {
        const fullIdx = partition.freeIndices[j]!;
        bFree[2 * j] = b[2 * fullIdx]!;
        bFree[2 * j + 1] = b[2 * fullIdx + 1]!;
      }
      // Short-circuit: if b is essentially zero, v is already in
      // V_perp and we can return it unchanged.
      let bMaxAbs = 0;
      for (let i = 0; i < bFree.length; i++) {
        const a = Math.abs(bFree[i]!);
        if (a > bMaxAbs) bMaxAbs = a;
      }
      let zFree: Float64Array;
      if (bMaxAbs === 0) {
        zFree = new Float64Array(2 * nFree);
      } else {
        const inner = solveCBicgstab(Lfree, bFree, { tol: innerTol });
        if (!inner.converged) {
          throw new Error(
            `gradient deflator (complex): inner BiCGStab did not converge ` +
              `(rel residual ${inner.relResidual.toExponential(2)}, ${inner.iterations} iter)`,
          );
        }
        zFree = inner.x;
      }
      // Scatter z back to full node space (interleaved complex).
      const z = new Float64Array(2 * numNodes);
      for (let j = 0; j < nFree; j++) {
        const fullIdx = partition.freeIndices[j]!;
        z[2 * fullIdx] = zFree[2 * j]!;
        z[2 * fullIdx + 1] = zFree[2 * j + 1]!;
      }
      // P_perp v = v − G z
      const Gz = cspmv(Gc, z);
      const out = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i]! - Gz[i]!;
      return out;
    },
  };
}

// Suppress unused-import warning in the rare case scatterFreeToFull
// isn't otherwise referenced from this module.
void scatterFreeToFull;
