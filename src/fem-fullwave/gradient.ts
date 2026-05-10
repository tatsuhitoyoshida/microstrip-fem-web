/**
 * Discrete-gradient operator G and the associated **gradient deflator**
 * for the vector full-wave eigenvalue problem (Round 8c Stage 2.3b).
 *
 * Why this exists
 * ---------------
 * The curl-curl stiffness `K_tt` assembled by `vector-assembly.ts` is
 * *rank-deficient by design*. Any vector field of the form `E = ∇φ`
 * (a gradient of a scalar nodal field) has zero curl, so the entire
 * gradient subspace
 *
 *     V_grad  =  { G · f  :  f ∈ R^numNodes }
 *
 * is in the null space of `K_tt`. Treating that null space naively
 * pollutes inverse iteration with infinitely many spurious zero
 * eigenvalues. Real propagating modes (e.g. TE_10 in a closed PEC
 * waveguide) sit in the **M-orthogonal complement** of `V_grad`.
 *
 * What this module provides
 * -------------------------
 *   1. `assembleDiscreteGradient(topology, numNodes)` — the global edge×node
 *      incidence matrix `G` with `G[e, vLo] = -1`, `G[e, vHi] = +1`.
 *      Discrete identity: `(curl ∘ grad) = 0` is exact, i.e. for any
 *      nodal vector `f`, `K_tt · (G f) = 0` to floating-point round-off.
 *
 *   2. `buildGradientDeflator(G, M, options)` — a closure that projects
 *      an arbitrary edge-DoF vector `v` onto the M-orthogonal complement
 *      of the gradient subspace:
 *
 *          P_perp v  =  v − G · z,     where  (Gᵀ M G) z = Gᵀ M v.
 *
 *      `Gᵀ M G` is the discrete (M-weighted) Laplacian on the nodal
 *      space — symmetric, positive *semi-*definite (constants are in its
 *      null space). To make it solvable by CG we pin one nodal DoF to
 *      zero (or, in PEC settings, we pin the entire boundary). The
 *      `pinnedNodes` option carries that choice.
 *
 * Why this layout (Gᵀ M G explicit)
 * ---------------------------------
 * Computing `L = Gᵀ M G` once and storing it in CSR is cheap on
 * cross-section meshes (a few thousand nodes, ~10 nz per row). After
 * that the deflator is two SpMVs + one CG inner solve per `project()`,
 * and the inner solve is on a **scalar** discrete-Laplacian system that
 * the project's existing Jacobi-PCG handles in a few dozen iterations.
 *
 * References:
 *   J.-M. Jin, "The Finite Element Method in Electromagnetics" (3rd ed.)
 *   §9.4 — tree/cotree gauging and gradient projection for vector FEM.
 *   D. White, J. Koning, "Computational electromagnetics with edge
 *   elements", LLNL UCRL-JC-145887 (2002), §3.3 — explicit gradient
 *   deflation as a preconditioner for indefinite curl-curl operators.
 */

import type { EdgeTopology } from './edge-dofs';
import {
  partitionDirichlet,
  restrictToFree,
  scatterFreeToFull,
  type DirichletPartition,
} from './boundary';
import { CooBuilder, type CsrMatrix, spmv, spmvT } from '../fem/sparse';
import { solveCgJacobi } from '../fem/solver';

/**
 * Build the discrete-gradient (incidence) operator `G` of size
 * `numEdges × numNodes`. Each row has exactly two non-zeros:
 *
 *     G[e, vLo(e)]  = -1
 *     G[e, vHi(e)]  = +1
 *
 * with `(vLo, vHi)` the global tangent endpoints recorded in the edge
 * topology. Multiplying `G · f` produces the edge-DoF representation of
 * the discrete gradient `∇_h f` of a nodal scalar field — i.e. the
 * line integral `f(vHi) - f(vLo)` along each edge.
 */
export function assembleDiscreteGradient(
  topology: EdgeTopology,
  numNodes: number,
): CsrMatrix {
  const builder = new CooBuilder(topology.numEdges, numNodes);
  for (let e = 0; e < topology.numEdges; e++) {
    const vLo = topology.edgeVertices[2 * e]!;
    const vHi = topology.edgeVertices[2 * e + 1]!;
    builder.add(e, vLo, -1);
    builder.add(e, vHi, 1);
  }
  return builder.toCsr();
}

/**
 * Assemble the (M-weighted) discrete nodal Laplacian `L = Gᵀ M G`.
 *
 * Done by walking the non-zeros of `M` once — for each pair of edges
 * `(e1, e2)` connected through `M` we drop their (sign·sign·M_e1e2)
 * contribution into the four (vLo/vHi-of-e1) × (vLo/vHi-of-e2) cells.
 * That's 4 nz of `L` per nz of `M`, no SpGEMM required.
 *
 * `L` is square `numNodes × numNodes`, symmetric, positive semi-definite.
 * Constants are in its null space (since G·1 = 0).
 */
function assembleNodalGramian(G: CsrMatrix, M: CsrMatrix): CsrMatrix {
  if (M.numRows !== G.numRows || M.numCols !== G.numRows) {
    throw new Error(
      `assembleNodalGramian: M must be ${G.numRows}×${G.numRows}, ` +
        `got ${M.numRows}×${M.numCols}`,
    );
  }
  const numNodes = G.numCols;
  const builder = new CooBuilder(numNodes);
  for (let e1 = 0; e1 < M.numRows; e1++) {
    const g1Start = G.rowPtr[e1]!;
    const g1End = G.rowPtr[e1 + 1]!;
    for (let kM = M.rowPtr[e1]!; kM < M.rowPtr[e1 + 1]!; kM++) {
      const e2 = M.colIdx[kM]!;
      const mVal = M.values[kM]!;
      const g2Start = G.rowPtr[e2]!;
      const g2End = G.rowPtr[e2 + 1]!;
      for (let k1 = g1Start; k1 < g1End; k1++) {
        const v1 = G.colIdx[k1]!;
        const g1 = G.values[k1]!;
        for (let k2 = g2Start; k2 < g2End; k2++) {
          const v2 = G.colIdx[k2]!;
          const g2 = G.values[k2]!;
          builder.add(v1, v2, g1 * mVal * g2);
        }
      }
    }
  }
  return builder.toCsr();
}

/**
 * M-orthogonal projector onto the complement of the gradient subspace.
 * Calling `project(v)` returns a fresh `Float64Array` `P_perp v`; the
 * input is not mutated.
 */
export interface GradientDeflator {
  project(v: Float64Array): Float64Array;
}

export interface GradientDeflatorOptions {
  /**
   * Nodes to drop when solving the Laplacian system. The mathematics
   * doesn't *require* any pinning — `L = Gᵀ M G` already lives on the
   * Gauss-quotient space — but Jacobi-PCG wants an SPD operator. Pin at
   * least one node when the gradient subspace is rank-1-deficient
   * (i.e. when no nodes are PEC-fixed yet). For closed PEC problems,
   * pass *all* boundary nodes here so the projection lives on the same
   * function space as the free edges.
   *
   * Defaults to `[0]` (pin a single node), which is the right behaviour
   * when this deflator is called on the *full* edge space.
   */
  pinnedNodes?: Iterable<number>;
  /** Inner-CG tolerance. Default 1e-12. */
  innerTol?: number;
}

export function buildGradientDeflator(
  G: CsrMatrix,
  M: CsrMatrix,
  options: GradientDeflatorOptions = {},
): GradientDeflator {
  const innerTol = options.innerTol ?? 1e-12;
  const numNodes = G.numCols;

  const L = assembleNodalGramian(G, M);
  const pinned: Iterable<number> =
    options.pinnedNodes !== undefined ? options.pinnedNodes : [0];
  const partition: DirichletPartition = partitionDirichlet(numNodes, pinned);
  const Lfree = restrictToFree(L, partition);

  return {
    project(v: Float64Array): Float64Array {
      if (v.length !== G.numRows) {
        throw new Error(
          `gradient deflator: v has length ${v.length}, expected ${G.numRows}`,
        );
      }
      // b = Gᵀ M v
      const Mv = spmv(M, v);
      const b = spmvT(G, Mv);
      // Restrict to free nodes
      const nFree = partition.freeIndices.length;
      const bFree = new Float64Array(nFree);
      for (let j = 0; j < nFree; j++) {
        bFree[j] = b[partition.freeIndices[j]!]!;
      }
      // Short-circuit: if the RHS is already zero, v is in the M-perp
      // subspace, and any constant z works (we want z = 0 to make
      // P_perp v = v exact).
      let bMaxAbs = 0;
      for (let j = 0; j < nFree; j++) {
        const a = Math.abs(bFree[j]!);
        if (a > bMaxAbs) bMaxAbs = a;
      }
      let z: Float64Array;
      if (bMaxAbs === 0) {
        z = new Float64Array(numNodes);
      } else {
        const cg = solveCgJacobi(Lfree, bFree, { tol: innerTol });
        if (!cg.converged) {
          throw new Error(
            `gradient deflator: inner CG did not converge ` +
              `(rel residual ${cg.relResidual.toExponential(2)} after ${cg.iterations} iter)`,
          );
        }
        z = scatterFreeToFull(cg.x, partition);
      }
      // P_perp v = v - G z
      const Gz = spmv(G, z);
      const out = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i]! - Gz[i]!;
      return out;
    },
  };
}
