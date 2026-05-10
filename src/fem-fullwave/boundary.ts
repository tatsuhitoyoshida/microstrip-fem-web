/**
 * Dirichlet handling for the scalar-Helmholtz generalised eigenvalue
 * problem (Round 8b).
 *
 * For TM-z modes the field vanishes on the PEC boundary, so the
 * corresponding rows/cols must be eliminated from the eigenvalue
 * problem. We do this by **extracting the free-DOF submatrix** rather
 * than penalty-tweaking the full matrix:
 *
 *   - cleaner numerics (no spurious eigenvalues at fake values)
 *   - smaller matrices for the solver
 *   - eigenvector reconstruction is a simple scatter
 *
 * For TE-z modes the boundary is Neumann (∂H_z/∂n = 0) which is
 * already the natural boundary condition of the weak form — no row/col
 * elimination needed. This module is a no-op in that case and tests can
 * skip the partitioning altogether.
 */

import { CooBuilder, type CsrMatrix } from '../fem/sparse';

export interface DirichletPartition {
  /** Length nFree. Original-system indices of the free (non-Dirichlet) DOFs. */
  freeIndices: Int32Array;
  /**
   * Length n (total DOFs). `freeOf[i] = j` if node i is the j-th free DOF,
   * or `-1` if i is on the Dirichlet boundary. Used to build / scatter
   * vectors between full and reduced spaces.
   */
  freeOf: Int32Array;
}

/**
 * Build a free-DOF partition given the set of Dirichlet (fixed-zero)
 * node indices. Iteration order over `dirichletNodes` doesn't matter;
 * duplicates are tolerated.
 */
export function partitionDirichlet(
  n: number,
  dirichletNodes: Iterable<number>,
): DirichletPartition {
  const isDirichlet = new Uint8Array(n);
  for (const d of dirichletNodes) {
    if (d >= 0 && d < n) isDirichlet[d] = 1;
  }
  const free: number[] = [];
  const freeOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (isDirichlet[i] === 1) {
      freeOf[i] = -1;
    } else {
      freeOf[i] = free.length;
      free.push(i);
    }
  }
  return { freeIndices: Int32Array.from(free), freeOf };
}

/**
 * Extract the (free × free) submatrix from `A`, dropping any row or
 * column that maps to a Dirichlet node. Symmetry of `A` is preserved
 * (the operation is the same on both axes).
 */
export function restrictToFree(A: CsrMatrix, partition: DirichletPartition): CsrMatrix {
  const nFree = partition.freeIndices.length;
  const builder = new CooBuilder(nFree);
  for (let i = 0; i < A.n; i++) {
    const fi = partition.freeOf[i]!;
    if (fi === -1) continue;
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k++) {
      const j = A.colIdx[k]!;
      const fj = partition.freeOf[j]!;
      if (fj === -1) continue;
      builder.add(fi, fj, A.values[k]!);
    }
  }
  return builder.toCsr();
}

/**
 * Scatter a free-DOF eigenvector back into a full-system vector. The
 * Dirichlet entries are filled with 0 (since that's the homogeneous BC
 * value).
 */
export function scatterFreeToFull(
  freeVec: Float64Array,
  partition: DirichletPartition,
): Float64Array {
  const full = new Float64Array(partition.freeOf.length);
  for (let i = 0; i < full.length; i++) {
    const f = partition.freeOf[i]!;
    if (f >= 0) full[i] = freeVec[f]!;
  }
  return full;
}
