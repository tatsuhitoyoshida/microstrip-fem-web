/**
 * Apply Dirichlet boundary conditions to a CSR FEM system by row/column
 * elimination — the standard, well-conditioned alternative to the penalty
 * method.
 *
 * For each Dirichlet node i with prescribed φ̂_i, we:
 *   1. Subtract the column-i contribution K[:, i] · φ̂_i from b (so the
 *      remaining free-free system stays consistent),
 *   2. Zero row i and column i of K,
 *   3. Set K[i, i] = 1 and b[i] = φ̂_i, decoupling the Dirichlet DOF.
 *
 * The resulting matrix is symmetric, well-conditioned, and well-suited to
 * Jacobi-preconditioned CG. The penalty method gives identical solutions in
 * exact arithmetic but its residual norm is dominated by the penalty rows,
 * which fools iterative solvers into terminating before the interior
 * residual is small.
 */

import { spmv, type CsrMatrix } from './sparse';
import type { Mesh } from '../types';

/** Returns the prescribed potential for a vertex marker, or `null` if free. */
export type DirichletForMarker = (marker: number) => number | null;

export interface AppliedBc {
  /** RHS vector (length = mesh.vertices.length / 2). */
  rhs: Float64Array;
  /** Indices of nodes that received a Dirichlet condition. */
  dirichletNodes: Int32Array;
  /** Prescribed values, parallel to {@link dirichletNodes}. */
  dirichletValues: Float64Array;
}

/**
 * Mutates `K` in place so that Dirichlet rows/columns are decoupled. Returns
 * the matching RHS vector. Pass a freshly cloned K if the original is needed
 * later (e.g. for energy / capacitance via {@link quadraticForm}).
 */
export function applyDirichletElimination(
  K: CsrMatrix,
  mesh: Mesh,
  dirichletForMarker: DirichletForMarker,
): AppliedBc {
  const n = mesh.vertexMarkers.length;
  if (K.numRows !== n || K.numCols !== n) {
    throw new Error(
      `applyDirichletElimination: K is ${K.numRows}×${K.numCols} but mesh has ${n} vertices`,
    );
  }

  const isDirichlet = new Uint8Array(n);
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = dirichletForMarker(mesh.vertexMarkers[i]!);
    if (v !== null) {
      isDirichlet[i] = 1;
      value[i] = v;
    }
  }

  // rhs ← −K · φ_D  (φ_D has prescribed values at Dirichlet, 0 elsewhere).
  const phiD = new Float64Array(n);
  for (let i = 0; i < n; i++) if (isDirichlet[i]) phiD[i] = value[i]!;
  const Kphi = spmv(K, phiD);
  const rhs = new Float64Array(n);
  for (let j = 0; j < n; j++) rhs[j] = -Kphi[j]!;

  // Override Dirichlet rows of rhs with the prescribed value itself.
  for (let i = 0; i < n; i++) if (isDirichlet[i]) rhs[i] = value[i]!;

  // Zero rows/columns at Dirichlet indices in K, set diagonals to 1.
  for (let i = 0; i < n; i++) {
    const start = K.rowPtr[i]!;
    const end = K.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      const j = K.colIdx[k]!;
      if (isDirichlet[i] || isDirichlet[j]) {
        K.values[k] = isDirichlet[i] && i === j ? 1 : 0;
      }
    }
  }

  const nodes: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isDirichlet[i]) {
      nodes.push(i);
      values.push(value[i]!);
    }
  }
  return {
    rhs,
    dirichletNodes: Int32Array.from(nodes),
    dirichletValues: Float64Array.from(values),
  };
}
