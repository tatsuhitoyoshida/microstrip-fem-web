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
 */

/** Compressed Sparse Row representation of an N × N matrix. */
export interface CsrMatrix {
  n: number;
  rowPtr: Int32Array; // length n + 1
  colIdx: Int32Array; // length nnz
  values: Float64Array; // length nnz
}

/** Triplet accumulator for element-by-element assembly. */
export class CooBuilder {
  readonly n: number;
  private readonly rows: number[] = [];
  private readonly cols: number[] = [];
  private readonly vals: number[] = [];

  constructor(n: number) {
    this.n = n;
  }

  /** Push a single (i, j, value) triplet. Duplicates are summed at compaction. */
  add(i: number, j: number, value: number): void {
    this.rows.push(i);
    this.cols.push(j);
    this.vals.push(value);
  }

  /** Compact triplets into a sorted, duplicate-summed CSR matrix. */
  toCsr(): CsrMatrix {
    const n = this.n;
    const nnzRaw = this.rows.length;

    // count non-zeros per row
    const rowPtr = new Int32Array(n + 1);
    for (let k = 0; k < nnzRaw; k++) {
      const idx = this.rows[k]! + 1;
      rowPtr[idx] = rowPtr[idx]! + 1;
    }
    for (let i = 0; i < n; i++) {
      rowPtr[i + 1] = rowPtr[i + 1]! + rowPtr[i]!;
    }

    // bucket triplets by row (raw, with duplicates)
    const rawCol = new Int32Array(nnzRaw);
    const rawVal = new Float64Array(nnzRaw);
    const rowFill = new Int32Array(n);
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
    const finalRowPtr = new Int32Array(n + 1);
    for (let r = 0; r < n; r++) {
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
    finalRowPtr[n] = finalCol.length;

    return {
      n,
      rowPtr: finalRowPtr,
      colIdx: Int32Array.from(finalCol),
      values: Float64Array.from(finalVal),
    };
  }
}

/** y ← A · x. Allocates `y` if `out` not supplied. */
export function spmv(A: CsrMatrix, x: Float64Array, out?: Float64Array): Float64Array {
  const y = out ?? new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) {
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

/** Extract the diagonal as a dense vector. Missing diagonals are 0. */
export function diagonal(A: CsrMatrix): Float64Array {
  const d = new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) {
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
    n: A.n,
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
