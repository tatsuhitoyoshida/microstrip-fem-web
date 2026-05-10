/**
 * Schur-complement mass matrix for the mixed (E_t, E_z) waveguide
 * eigenvalue problem (Round 8c Stage 2.5b).
 *
 * The mixed weak form is quadratic in β:
 *
 *     (K_t − β² M_t) u  +  jβ C_tz v  =  0     (edge eq)
 *     K_n v  +  jβ C_tz^T u            =  0     (node eq)
 *
 * Eliminating `v = −jβ K_n⁻¹ C_tz^T u` from the node equation and
 * substituting into the edge equation collapses the −jβ × −jβ = β² and
 * leaves a **linear** generalised eigenvalue problem on the edge DoFs:
 *
 *     K_t u  =  β² M̃ u,    M̃ := M_t − C_tz K_n⁻¹ C_tz^T
 *
 * `M̃` is the Schur-complement mass: symmetric (since K_n is) and
 * positive-definite when `k₀²` sits below the smallest TM cutoff (=
 * smallest scalar Helmholtz Dirichlet eigenvalue of `K_grad / M_eps`)
 * on the same mesh; indefinite above. We assemble it explicitly as a
 * CSR matrix here so the existing shift-invert eigensolver can consume
 * it without further refactoring.
 *
 * Cost: one inner CG/MINRES solve on K_n per *edge column* (or per
 * *node column*, whichever is smaller; we drive by edges since the
 * eigsolver works in edge space). For the closed-waveguide validation
 * meshes (≤ ~600 free edges) that's ~500 sub-second solves and the
 * result is dense-ish but still small.
 *
 * Future: for production-scale microstrip we'd want to **avoid
 * materialising M̃**; the eigsolver could take an operator callable
 * (`x ↦ M̃ x`) instead, which would be one inner solve per outer
 * iteration. That refactor is deferred — this module gets the maths
 * validated end-to-end first.
 */

import { CooBuilder, type CsrMatrix, spmv } from '../../../src/fem/sparse';
import { solveCgJacobi } from '../../../src/fem/solver';
import { solveMinres } from './minres';

export interface SchurMassOptions {
  /** Inner-solve relative residual tolerance. Default 1e-12. */
  innerTol?: number;
  /**
   * Strategy for the inner K_n solve. `cg` requires K_n SPD (typically
   * `k₀²` below the smallest TM cutoff); `minres` works in either case
   * but is ~2× slower per iteration. Default `cg`.
   */
  innerSolver?: 'cg' | 'minres';
  /** Drop entries with absolute value below this when assembling M̃ as
   *  a sparse CSR. Default 0 (keep everything; M̃ tends to be dense). */
  sparsifyTol?: number;
}

/**
 * Build the Schur-complement mass matrix
 *
 *     M̃  =  M_t  −  C_tz · K_n⁻¹ · C_tz^T
 *
 * column-by-column. For each edge column `j`:
 *
 *   1. RHS  =  row j of C_tz, scattered into a numNodes vector
 *      (this is the j-th column of C_tzᵀ).
 *   2. Solve K_n · y_j  =  RHS  via inner CG (or MINRES).
 *   3. The j-th column of `C_tz K_n⁻¹ C_tz^T` is `C_tz · y_j`.
 *   4. Subtract it from the j-th column of M_t.
 *
 * Inputs must be the *free*-DoF restricted matrices (boundary edges
 * and boundary nodes already eliminated); shapes must agree:
 * `M_t: numEdges × numEdges`, `C_tz: numEdges × numNodes`,
 * `K_n: numNodes × numNodes`.
 */
export function assembleSchurMass(
  Mt: CsrMatrix,
  Ctz: CsrMatrix,
  Kn: CsrMatrix,
  options: SchurMassOptions = {},
): CsrMatrix {
  if (Mt.numRows !== Mt.numCols) {
    throw new Error(`assembleSchurMass: M_t must be square, got ${Mt.numRows}×${Mt.numCols}`);
  }
  if (Kn.numRows !== Kn.numCols) {
    throw new Error(`assembleSchurMass: K_n must be square, got ${Kn.numRows}×${Kn.numCols}`);
  }
  if (Ctz.numRows !== Mt.numRows) {
    throw new Error(
      `assembleSchurMass: C_tz row count (${Ctz.numRows}) ≠ M_t size (${Mt.numRows})`,
    );
  }
  if (Ctz.numCols !== Kn.numRows) {
    throw new Error(
      `assembleSchurMass: C_tz col count (${Ctz.numCols}) ≠ K_n size (${Kn.numRows})`,
    );
  }

  const numEdges = Mt.numRows;
  const numNodes = Kn.numRows;
  const innerTol = options.innerTol ?? 1e-12;
  const innerSolver = options.innerSolver ?? 'cg';
  const sparsifyTol = options.sparsifyTol ?? 0;

  const builder = new CooBuilder(numEdges);

  // Start with M_t copied in (will subtract the Schur term column-wise).
  for (let i = 0; i < numEdges; i++) {
    for (let k = Mt.rowPtr[i]!; k < Mt.rowPtr[i + 1]!; k++) {
      builder.add(i, Mt.colIdx[k]!, Mt.values[k]!);
    }
  }

  // For each edge column j, compute (C_tz K_n⁻¹ C_tz^T)_{:,j} and subtract.
  const rhs = new Float64Array(numNodes);
  for (let j = 0; j < numEdges; j++) {
    // Skip edges whose row of C_tz is empty — their column contribution
    // is zero, so M̃_{:, j} = M_t_{:, j} unchanged.
    const rowStart = Ctz.rowPtr[j]!;
    const rowEnd = Ctz.rowPtr[j + 1]!;
    if (rowStart === rowEnd) continue;

    rhs.fill(0);
    for (let k = rowStart; k < rowEnd; k++) {
      rhs[Ctz.colIdx[k]!] = Ctz.values[k]!;
    }

    const result =
      innerSolver === 'cg'
        ? solveCgJacobi(Kn, rhs, { tol: innerTol })
        : solveMinres(Kn, rhs, { tol: innerTol });
    if (!result.converged) {
      throw new Error(
        `assembleSchurMass: inner ${innerSolver.toUpperCase()} did not converge ` +
          `at edge column ${j} ` +
          `(rel residual ${result.relResidual.toExponential(2)}, ${result.iterations} iter)`,
      );
    }
    const y = result.x;

    // col_j = C_tz · y (numEdges-vector). Subtract from M̃_{:, j}.
    const colJ = spmv(Ctz, y);
    for (let i = 0; i < numEdges; i++) {
      const v = -colJ[i]!;
      if (v === 0) continue;
      if (sparsifyTol > 0 && Math.abs(v) < sparsifyTol) continue;
      builder.add(i, j, v);
    }
  }

  return builder.toCsr();
}
