/**
 * Minimal sparse-matrix utilities used by the FEM assembly + CG solver.
 *
 * Design choices:
 *   - During element-by-element assembly we accumulate (row, col, value)
 *     triplets into a {@link CooBuilder}. Duplicate entries are summed
 *     when we compact to CSR.
 *   - The solver consumes the resulting symmetric CSR matrix via
 *     {@link spmv} (sparse matrix-vector product).
 *   - Pure TypeScript — no native or WASM dependency. The microstrip FEM
 *     scale (~10k DOF) makes this perfectly adequate.
 *
 * **Rectangular matrices** (Round 8c): the type was originally pinned to
 * square matrices via a single `n` field. Vector full-wave's edge-node
 * coupling block (`A_tz` with `numEdges` rows and `numNodes` columns)
 * forced a generalisation to `numRows × numCols`. Square matrices stay
 * convenient — `CooBuilder(n)` defaults `numCols = n`, and `spmv`
 * autodetects from `numCols` how long the input vector should be.
 */

/** Compressed Sparse Row representation of a numRows × numCols matrix. */
export interface CsrMatrix {
  numRows: number;
  numCols: number;
  rowPtr: Int32Array; // length numRows + 1
  colIdx: Int32Array; // length nnz
  values: Float64Array; // length nnz
}

/** Triplet accumulator for element-by-element assembly. */
export class CooBuilder {
  readonly numRows: number;
  readonly numCols: number;
  private readonly rows: number[] = [];
  private readonly cols: number[] = [];
  private readonly vals: number[] = [];

  /**
   * @param numRows Number of rows in the eventual matrix.
   * @param numCols Number of columns. Defaults to `numRows` (square).
   */
  constructor(numRows: number, numCols?: number) {
    this.numRows = numRows;
    this.numCols = numCols ?? numRows;
  }

  /** Push a single (i, j, value) triplet. Duplicates are summed at compaction. */
  add(i: number, j: number, value: number): void {
    this.rows.push(i);
    this.cols.push(j);
    this.vals.push(value);
  }

  /** Compact triplets into a sorted, duplicate-summed CSR matrix. */
  toCsr(): CsrMatrix {
    const numRows = this.numRows;
    const numCols = this.numCols;
    const nnzRaw = this.rows.length;

    // count non-zeros per row
    const rowPtr = new Int32Array(numRows + 1);
    for (let k = 0; k < nnzRaw; k++) {
      const idx = this.rows[k]! + 1;
      rowPtr[idx] = rowPtr[idx]! + 1;
    }
    for (let i = 0; i < numRows; i++) {
      rowPtr[i + 1] = rowPtr[i + 1]! + rowPtr[i]!;
    }

    // bucket triplets by row (raw, with duplicates)
    const rawCol = new Int32Array(nnzRaw);
    const rawVal = new Float64Array(nnzRaw);
    const rowFill = new Int32Array(numRows);
    for (let k = 0; k < nnzRaw; k++) {
      const r = this.rows[k]!;
      const dest = rowPtr[r]! + rowFill[r]!;
      rawCol[dest] = this.cols[k]!;
      rawVal[dest] = this.vals[k]!;
      rowFill[r] = rowFill[r]! + 1;
    }

    // For each row, sort by column and merge duplicates.
    const finalCol: number[] = [];
    const finalVal: number[] = [];
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
        const v = rawVal[idx]!;
        if (c === lastCol) {
          finalVal[finalVal.length - 1] = finalVal[finalVal.length - 1]! + v;
        } else {
          finalCol.push(c);
          finalVal.push(v);
          lastCol = c;
        }
      }
    }
    finalRowPtr[numRows] = finalCol.length;

    return {
      numRows,
      numCols,
      rowPtr: finalRowPtr,
      colIdx: Int32Array.from(finalCol),
      values: Float64Array.from(finalVal),
    };
  }
}

/**
 * y ← A · x. Allocates `y` (length `A.numRows`) if `out` is not
 * supplied. The input `x` must have length `A.numCols`.
 */
export function spmv(A: CsrMatrix, x: Float64Array, out?: Float64Array): Float64Array {
  if (x.length !== A.numCols) {
    throw new Error(`spmv: A is ${A.numRows}×${A.numCols} but x has length ${x.length}`);
  }
  const y = out ?? new Float64Array(A.numRows);
  for (let i = 0; i < A.numRows; i++) {
    let s = 0;
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      s += A.values[k]! * x[A.colIdx[k]!]!;
    }
    y[i] = s;
  }
  return y;
}

/**
 * y ← Aᵀ · x. Useful for rectangular blocks (e.g. vector full-wave's
 * `A_zt = A_tzᵀ` edge-node coupling) where we want both A·x and Aᵀ·y
 * matvecs without storing the transpose explicitly.
 *
 * Allocates `y` (length `A.numCols`) if `out` is not supplied. Input
 * `x` must have length `A.numRows`.
 */
export function spmvT(A: CsrMatrix, x: Float64Array, out?: Float64Array): Float64Array {
  if (x.length !== A.numRows) {
    throw new Error(`spmvT: A is ${A.numRows}×${A.numCols} but x has length ${x.length}`);
  }
  const y = out ?? new Float64Array(A.numCols);
  if (out !== undefined) y.fill(0);
  for (let i = 0; i < A.numRows; i++) {
    const xi = x[i]!;
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      y[A.colIdx[k]!] = y[A.colIdx[k]!]! + A.values[k]! * xi;
    }
  }
  return y;
}

/** Extract the diagonal as a dense vector. Missing diagonals are 0. Square only. */
export function diagonal(A: CsrMatrix): Float64Array {
  if (A.numRows !== A.numCols) {
    throw new Error(`diagonal: matrix must be square, got ${A.numRows}×${A.numCols}`);
  }
  const n = A.numRows;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    for (let k = start; k < end; k++) {
      if (A.colIdx[k]! === i) {
        d[i] = A.values[k]!;
        break;
      }
    }
  }
  return d;
}

/** In-place: A.values[diag(i)] += delta for each i. Throws if any diagonal entry is missing. */
export function addToDiagonal(A: CsrMatrix, indices: ArrayLike<number>, delta: number): void {
  for (let m = 0; m < indices.length; m++) {
    const i = indices[m]!;
    const start = A.rowPtr[i]!;
    const end = A.rowPtr[i + 1]!;
    let found = false;
    for (let k = start; k < end; k++) {
      if (A.colIdx[k]! === i) {
        A.values[k] = A.values[k]! + delta;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`addToDiagonal: row ${i} has no diagonal entry`);
    }
  }
}

/** Deep copy a CSR matrix. */
export function cloneCsr(A: CsrMatrix): CsrMatrix {
  return {
    numRows: A.numRows,
    numCols: A.numCols,
    rowPtr: new Int32Array(A.rowPtr),
    colIdx: new Int32Array(A.colIdx),
    values: new Float64Array(A.values),
  };
}

/** xᵀ y dot product. */
export function dot(x: Float64Array, y: Float64Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * y[i]!;
  return s;
}

/** y ← y + a · x. */
export function axpy(a: number, x: Float64Array, y: Float64Array): void {
  for (let i = 0; i < x.length; i++) y[i] = y[i]! + a * x[i]!;
}

/** y ← x + a · y  (self-scaling vector update). */
export function xpay(a: number, x: Float64Array, y: Float64Array): void {
  for (let i = 0; i < x.length; i++) y[i] = x[i]! + a * y[i]!;
}
