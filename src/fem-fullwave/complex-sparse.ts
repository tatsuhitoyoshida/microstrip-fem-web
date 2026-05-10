/**
 * Complex sparse-matrix utilities for the PML path (Round 8c Stage 3a-i).
 *
 * PML coordinate stretching turns the otherwise-real anisotropic
 * material tensors into complex tensors:
 *
 *     s_x(x)  =  1  −  j σ_x(x) / ω
 *
 * appears multiplicatively in the curl-curl / mass weights, dragging
 * complex coefficients into the assembled matrices. From there, the
 * eigenvalue problem becomes **complex symmetric** (NOT Hermitian —
 * PML deliberately breaks Hermitian symmetry so outgoing waves can be
 * absorbed) which means the standard real MINRES / CG pipelines don't
 * apply directly: those rely on positive-definite or sign-indefinite
 * **Hermitian** structure.
 *
 * This module mirrors `src/fem/sparse.ts` but for complex storage.
 * The existing real-valued path is untouched — code that doesn't go
 * through PML keeps its hot-loop cache layout and avoids the
 * 2× memory / 4× FLOP overhead of complex arithmetic.
 *
 * Storage is interleaved `[re_0, im_0, re_1, im_1, …]` for cache
 * locality and to mirror the BLAS convention. Split (real / imag)
 * arrays would be marginally easier to pretty-print but worse on the
 * dot-product hot loops where you want both halves of a value within
 * one cache line.
 *
 * Two distinct inner products live here, intentionally:
 *
 *   - `cdot(x, y)   =  Σ x_i y_i`       — bilinear form (NO conjugation).
 *     The complex-symmetric Lanczos / MINRES variant needs this; its
 *     Lanczos vectors are *bi*-orthogonal w.r.t. cdot, not orthogonal
 *     w.r.t. the Hermitian inner product.
 *
 *   - `cdotH(x, y)  =  Σ x̄_i y_i`       — sesquilinear (Hermitian) form.
 *     Used for 2-norm tracking and convergence checks. Note that
 *     ‖x‖² = Re(cdotH(x, x)) is real and non-negative.
 *
 * Mixing the two by accident is the classic complex-symmetric Krylov
 * bug. The naming is intentionally distinct so call sites read the
 * right one.
 */

/** Compressed Sparse Row representation of a complex numRows × numCols matrix. */
export interface ComplexCsrMatrix {
  numRows: number;
  numCols: number;
  rowPtr: Int32Array; // length numRows + 1
  colIdx: Int32Array; // length nnz
  /** Interleaved: `values[2*k] = Re(A_k)`, `values[2*k+1] = Im(A_k)`.
   *  Length 2 * nnz. */
  values: Float64Array;
}

/** Triplet accumulator for complex element-by-element assembly. */
export class ComplexCooBuilder {
  readonly numRows: number;
  readonly numCols: number;
  private readonly rows: number[] = [];
  private readonly cols: number[] = [];
  private readonly valsRe: number[] = [];
  private readonly valsIm: number[] = [];

  constructor(numRows: number, numCols?: number) {
    this.numRows = numRows;
    this.numCols = numCols ?? numRows;
  }

  /** Push a single (i, j, re + j·im) triplet. Duplicates are summed at compaction. */
  add(i: number, j: number, valueRe: number, valueIm: number): void {
    this.rows.push(i);
    this.cols.push(j);
    this.valsRe.push(valueRe);
    this.valsIm.push(valueIm);
  }

  /** Compact triplets into a sorted, duplicate-summed CSR matrix. */
  toCsr(): ComplexCsrMatrix {
    const numRows = this.numRows;
    const numCols = this.numCols;
    const nnzRaw = this.rows.length;

    const rowPtr = new Int32Array(numRows + 1);
    for (let k = 0; k < nnzRaw; k++) {
      const idx = this.rows[k]! + 1;
      rowPtr[idx] = rowPtr[idx]! + 1;
    }
    for (let i = 0; i < numRows; i++) {
      rowPtr[i + 1] = rowPtr[i + 1]! + rowPtr[i]!;
    }

    const rawCol = new Int32Array(nnzRaw);
    const rawValRe = new Float64Array(nnzRaw);
    const rawValIm = new Float64Array(nnzRaw);
    const rowFill = new Int32Array(numRows);
    for (let k = 0; k < nnzRaw; k++) {
      const r = this.rows[k]!;
      const dest = rowPtr[r]! + rowFill[r]!;
      rawCol[dest] = this.cols[k]!;
      rawValRe[dest] = this.valsRe[k]!;
      rawValIm[dest] = this.valsIm[k]!;
      rowFill[r] = rowFill[r]! + 1;
    }

    const finalCol: number[] = [];
    const finalRe: number[] = [];
    const finalIm: number[] = [];
    const finalRowPtr = new Int32Array(numRows + 1);
    for (let r = 0; r < numRows; r++) {
      const start = rowPtr[r]!;
      const end = rowPtr[r + 1]!;
      const indices: number[] = [];
      for (let k = start; k < end; k++) indices.push(k);
      indices.sort((a, b) => rawCol[a]! - rawCol[b]!);

      finalRowPtr[r] = finalCol.length;
      let lastCol = -1;
      for (const idx of indices) {
        const c = rawCol[idx]!;
        const vRe = rawValRe[idx]!;
        const vIm = rawValIm[idx]!;
        if (c === lastCol) {
          const last = finalRe.length - 1;
          finalRe[last] = finalRe[last]! + vRe;
          finalIm[last] = finalIm[last]! + vIm;
        } else {
          finalCol.push(c);
          finalRe.push(vRe);
          finalIm.push(vIm);
          lastCol = c;
        }
      }
    }
    finalRowPtr[numRows] = finalCol.length;

    const values = new Float64Array(2 * finalCol.length);
    for (let k = 0; k < finalCol.length; k++) {
      values[2 * k] = finalRe[k]!;
      values[2 * k + 1] = finalIm[k]!;
    }

    return {
      numRows,
      numCols,
      rowPtr: finalRowPtr,
      colIdx: Int32Array.from(finalCol),
      values,
    };
  }
}

/**
 * y ← A · x. Allocates `y` (length `2 * A.numRows`) if `out` is not
 * supplied. The input `x` must have length `2 * A.numCols`.
 */
export function cspmv(
  A: ComplexCsrMatrix,
  x: Float64Array,
  out?: Float64Array,
): Float64Array {
  if (x.length !== 2 * A.numCols) {
    throw new Error(
      `cspmv: A is ${A.numRows}×${A.numCols} but x has length ${x.length} (expected ${2 * A.numCols})`,
    );
  }
  const y = out ?? new Float64Array(2 * A.numRows);
  for (let i = 0; i < A.numRows; i++) {
    let sumRe = 0;
    let sumIm = 0;
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      const aRe = A.values[2 * k]!;
      const aIm = A.values[2 * k + 1]!;
      const j = A.colIdx[k]!;
      const xRe = x[2 * j]!;
      const xIm = x[2 * j + 1]!;
      // (a + j b)(c + j d) = (ac − bd) + j(ad + bc)
      sumRe += aRe * xRe - aIm * xIm;
      sumIm += aRe * xIm + aIm * xRe;
    }
    y[2 * i] = sumRe;
    y[2 * i + 1] = sumIm;
  }
  return y;
}

/**
 * y ← Aᵀ · x (true transpose, NOT adjoint — no conjugation of A's
 * entries). For a complex symmetric A this is the same as A·x; for
 * general A it differs from the Hermitian conjugate `A^H = (Ā)ᵀ`.
 * Allocates `y` (length `2 * A.numCols`) if `out` is not supplied.
 */
export function cspmvT(
  A: ComplexCsrMatrix,
  x: Float64Array,
  out?: Float64Array,
): Float64Array {
  if (x.length !== 2 * A.numRows) {
    throw new Error(
      `cspmvT: A is ${A.numRows}×${A.numCols} but x has length ${x.length} (expected ${2 * A.numRows})`,
    );
  }
  const y = out ?? new Float64Array(2 * A.numCols);
  if (out !== undefined) y.fill(0);
  for (let i = 0; i < A.numRows; i++) {
    const xRe = x[2 * i]!;
    const xIm = x[2 * i + 1]!;
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      const aRe = A.values[2 * k]!;
      const aIm = A.values[2 * k + 1]!;
      const j = A.colIdx[k]!;
      y[2 * j] = y[2 * j]! + aRe * xRe - aIm * xIm;
      y[2 * j + 1] = y[2 * j + 1]! + aRe * xIm + aIm * xRe;
    }
  }
  return y;
}

/** Re/Im pair returned by the complex inner products. */
export interface Complex {
  re: number;
  im: number;
}

/**
 * Bilinear inner product:  Σ x_i y_i  (no conjugation).
 *
 * This is what complex-symmetric Lanczos / MINRES uses; the Lanczos
 * vectors come out *bi*-orthogonal w.r.t. this form. Note that
 * `cdot(x, x)` is **not** generally a real number — it can be complex
 * with non-zero imaginary part.
 */
export function cdot(x: Float64Array, y: Float64Array): Complex {
  if (x.length !== y.length) {
    throw new Error(`cdot: length mismatch (${x.length} vs ${y.length})`);
  }
  let re = 0;
  let im = 0;
  const n = x.length / 2;
  for (let i = 0; i < n; i++) {
    const xRe = x[2 * i]!;
    const xIm = x[2 * i + 1]!;
    const yRe = y[2 * i]!;
    const yIm = y[2 * i + 1]!;
    re += xRe * yRe - xIm * yIm;
    im += xRe * yIm + xIm * yRe;
  }
  return { re, im };
}

/**
 * Sesquilinear (Hermitian) inner product:  Σ x̄_i y_i.
 *
 * Used for 2-norm and convergence tests:
 *   ‖x‖² = Re(cdotH(x, x))  (always ≥ 0)
 * The imaginary part of `cdotH(x, x)` is zero by construction.
 */
export function cdotH(x: Float64Array, y: Float64Array): Complex {
  if (x.length !== y.length) {
    throw new Error(`cdotH: length mismatch (${x.length} vs ${y.length})`);
  }
  let re = 0;
  let im = 0;
  const n = x.length / 2;
  for (let i = 0; i < n; i++) {
    const xRe = x[2 * i]!;
    const xIm = x[2 * i + 1]!;
    const yRe = y[2 * i]!;
    const yIm = y[2 * i + 1]!;
    // x̄ · y = (xRe − j xIm)(yRe + j yIm)
    //       = (xRe·yRe + xIm·yIm)  +  j (xRe·yIm − xIm·yRe)
    re += xRe * yRe + xIm * yIm;
    im += xRe * yIm - xIm * yRe;
  }
  return { re, im };
}

/** ‖x‖₂ — Hermitian 2-norm of a complex vector. */
export function cnorm2(x: Float64Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s);
}

/** y ← y + α · x (complex α, complex x, complex y, all interleaved). */
export function caxpy(
  alphaRe: number,
  alphaIm: number,
  x: Float64Array,
  y: Float64Array,
): void {
  if (x.length !== y.length) {
    throw new Error(`caxpy: length mismatch (${x.length} vs ${y.length})`);
  }
  const n = x.length / 2;
  for (let i = 0; i < n; i++) {
    const xRe = x[2 * i]!;
    const xIm = x[2 * i + 1]!;
    y[2 * i] = y[2 * i]! + alphaRe * xRe - alphaIm * xIm;
    y[2 * i + 1] = y[2 * i + 1]! + alphaRe * xIm + alphaIm * xRe;
  }
}

/** y ← α · x  (overwrite). */
export function cscale(
  alphaRe: number,
  alphaIm: number,
  x: Float64Array,
  out?: Float64Array,
): Float64Array {
  const y = out ?? new Float64Array(x.length);
  const n = x.length / 2;
  for (let i = 0; i < n; i++) {
    const xRe = x[2 * i]!;
    const xIm = x[2 * i + 1]!;
    y[2 * i] = alphaRe * xRe - alphaIm * xIm;
    y[2 * i + 1] = alphaRe * xIm + alphaIm * xRe;
  }
  return y;
}

/** Promote a real CSR matrix to complex storage (imaginary part = 0).
 *  Useful to mix real and complex blocks in PML assemblies without
 *  duplicating the real-valued construction code. */
export function realToComplexCsr(A: {
  numRows: number;
  numCols: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
}): ComplexCsrMatrix {
  const nnz = A.values.length;
  const values = new Float64Array(2 * nnz);
  for (let k = 0; k < nnz; k++) {
    values[2 * k] = A.values[k]!;
    values[2 * k + 1] = 0;
  }
  return {
    numRows: A.numRows,
    numCols: A.numCols,
    rowPtr: new Int32Array(A.rowPtr),
    colIdx: new Int32Array(A.colIdx),
    values,
  };
}
