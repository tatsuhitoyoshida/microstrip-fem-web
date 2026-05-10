/**
 * Complex Schur-complement mass matrix for the PML mixed system
 * (Round 8c Stage 3a-v-c-2).
 *
 * Same construction as `schur.ts`:
 *
 *     M̃  =  M_t  −  C_tz · K_n⁻¹ · C_tz^T
 *
 * but with complex-valued blocks (PML-induced) and complex Bi-CGSTAB
 * for the inner K_n solve. Built column-by-column: for each free
 * edge `j`,
 *
 *   1. RHS  =  row j of C_tz, scattered into a numNodes vector
 *      (this is the j-th column of C_tzᵀ).
 *   2. Solve K_n y_j  =  RHS  via complex BiCGStab.
 *   3. The j-th column of `C_tz K_n⁻¹ C_tz^T` is `C_tz · y_j`.
 *   4. Subtract from the j-th column of M_t.
 *
 * The result is dense-ish but cheap to materialise on closed-box
 * validation meshes (≲ a thousand free edges, ~100-iter inner solve).
 * Production microstrip will want a matvec callable rather than an
 * explicit M̃; that's a Stage 3a-vi optimisation.
 */

import {
  ComplexCooBuilder,
  type ComplexCsrMatrix,
  cspmv,
} from './complex-sparse';
import { solveCBicgstab } from './complex-solver';

export interface ComplexSchurMassOptions {
  /** Inner-solve relative residual tolerance. Default 1e-12. */
  innerTol?: number;
  /** Drop entries with absolute value below this when assembling M̃.
   *  Default 0 (keep everything; M̃ tends to be dense). */
  sparsifyTol?: number;
}

/**
 * Build the complex Schur-complement mass M̃ = M_t − C_tz K_n⁻¹ C_tz^T
 * column-by-column.
 *
 * Inputs must be the *free*-DoF restricted matrices:
 *   M_t : numEdges × numEdges  (complex symmetric)
 *   C_tz: numEdges × numNodes  (complex, rectangular)
 *   K_n : numNodes × numNodes  (complex symmetric)
 *
 * Throws if the inner BiCGStab fails to converge on any column —
 * typically signals an ill-chosen k₀ landing on a TM cutoff in the
 * loaded medium.
 */
export function assembleSchurMassComplex(
  Mt: ComplexCsrMatrix,
  Ctz: ComplexCsrMatrix,
  Kn: ComplexCsrMatrix,
  options: ComplexSchurMassOptions = {},
): ComplexCsrMatrix {
  if (Mt.numRows !== Mt.numCols) {
    throw new Error(
      `assembleSchurMassComplex: M_t must be square, got ${Mt.numRows}×${Mt.numCols}`,
    );
  }
  if (Kn.numRows !== Kn.numCols) {
    throw new Error(
      `assembleSchurMassComplex: K_n must be square, got ${Kn.numRows}×${Kn.numCols}`,
    );
  }
  if (Ctz.numRows !== Mt.numRows) {
    throw new Error(
      `assembleSchurMassComplex: C_tz row count (${Ctz.numRows}) ≠ M_t size (${Mt.numRows})`,
    );
  }
  if (Ctz.numCols !== Kn.numRows) {
    throw new Error(
      `assembleSchurMassComplex: C_tz col count (${Ctz.numCols}) ≠ K_n size (${Kn.numRows})`,
    );
  }

  const numEdges = Mt.numRows;
  const numNodes = Kn.numRows;
  const innerTol = options.innerTol ?? 1e-12;
  const sparsifyTol = options.sparsifyTol ?? 0;

  const builder = new ComplexCooBuilder(numEdges);

  // Start with M_t copied in (will subtract the Schur term column-wise).
  for (let i = 0; i < numEdges; i++) {
    for (let k = Mt.rowPtr[i]!; k < Mt.rowPtr[i + 1]!; k++) {
      builder.add(i, Mt.colIdx[k]!, Mt.values[2 * k]!, Mt.values[2 * k + 1]!);
    }
  }

  const rhs = new Float64Array(2 * numNodes);
  for (let j = 0; j < numEdges; j++) {
    const rowStart = Ctz.rowPtr[j]!;
    const rowEnd = Ctz.rowPtr[j + 1]!;
    if (rowStart === rowEnd) continue;

    rhs.fill(0);
    for (let k = rowStart; k < rowEnd; k++) {
      const n = Ctz.colIdx[k]!;
      rhs[2 * n] = Ctz.values[2 * k]!;
      rhs[2 * n + 1] = Ctz.values[2 * k + 1]!;
    }

    const result = solveCBicgstab(Kn, rhs, { tol: innerTol });
    if (!result.converged) {
      throw new Error(
        `assembleSchurMassComplex: inner Bi-CGSTAB did not converge ` +
          `at edge column ${j} ` +
          `(rel residual ${result.relResidual.toExponential(2)}, ${result.iterations} iter)`,
      );
    }
    const y = result.x;
    const colJ = cspmv(Ctz, y);
    for (let i = 0; i < numEdges; i++) {
      const cRe = -colJ[2 * i]!;
      const cIm = -colJ[2 * i + 1]!;
      if (cRe === 0 && cIm === 0) continue;
      if (sparsifyTol > 0 && Math.hypot(cRe, cIm) < sparsifyTol) continue;
      builder.add(i, j, cRe, cIm);
    }
  }

  return builder.toCsr();
}
