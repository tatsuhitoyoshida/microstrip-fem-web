/**
 * Wrapper around triangle-wasm that turns a {@link Pslg} into a {@link Mesh}
 * with vertex/element arrays and basic quality diagnostics.
 *
 * Usage:
 *   await initMesh();              // browser default: '/triangle.out.wasm'
 *   const mesh = meshFromPslg(p);
 *
 * The WASM binary must be reachable at the URL passed to {@link initMesh}.
 * In production it is copied to `public/triangle.out.wasm` and served from
 * the site root; in tests it is loaded via a `file://` URL into Node's
 * native fetch.
 */

import * as Triangle from 'triangle-wasm';
import type { Mesh, Pslg } from '../types';

let initialized = false;

/** Resets the module-level "initialized" flag. Tests only. */
export function _resetInitForTesting(): void {
  initialized = false;
}

/**
 * Loads the Triangle WebAssembly module. Must be awaited before any call to
 * {@link meshFromPslg}. Calling more than once is a no-op.
 *
 * @param wasmUrl URL or file path passed to Emscripten's locateFile. Default
 *   `'/triangle.out.wasm'` matches the asset copied into `public/`.
 */
export async function initMesh(wasmUrl: string = '/triangle.out.wasm'): Promise<void> {
  if (initialized) return;
  await Triangle.init(wasmUrl);
  initialized = true;
}

export interface MeshOptions {
  /** Minimum interior angle of every triangle [deg]. Default 25. */
  minAngleDeg?: number;
  /**
   * Optional global maxArea cap (overrides regionlist values). When omitted,
   * Triangle uses the per-region maxArea written into the PSLG by
   * `geometry.ts`.
   */
  maxArea?: number;
}

export function meshFromPslg(pslg: Pslg, options: MeshOptions = {}): Mesh {
  if (!initialized) {
    throw new Error('triangle-wasm not initialized. Call initMesh() first.');
  }

  const switches = {
    pslg: true,
    quality: options.minAngleDeg ?? 25,
    area: options.maxArea ?? true,
    regionAttr: true,
    quiet: true,
  };

  const input = Triangle.makeIO({
    pointlist: pslg.pointlist,
    pointmarkerlist: pslg.pointmarkerlist,
    segmentlist: pslg.segmentlist,
    segmentmarkerlist: pslg.segmentmarkerlist,
    holelist: pslg.holelist,
    regionlist: pslg.regionlist,
  });
  const output = Triangle.makeIO();

  try {
    Triangle.triangulate(switches, input, output);

    // Triangle-wasm returns subarray views into WASM heap; copy them out
    // before freeIO so the data survives.
    const vertices = Float64Array.from(output.pointlist);
    const triangles = Int32Array.from(output.trianglelist ?? []);
    const triangleAttributes = Float64Array.from(output.triangleattributelist ?? []);
    const vertexMarkers = Int32Array.from(output.pointmarkerlist ?? []);

    if (triangles.length === 0) {
      throw new Error('triangle-wasm produced an empty mesh');
    }

    const minAngleDeg = computeMinAngleDeg(vertices, triangles);

    return {
      vertices,
      triangles,
      triangleAttributes,
      vertexMarkers,
      minAngleDeg,
      triangleCount: triangles.length / 3,
    };
  } finally {
    Triangle.freeIO(input, true);
    Triangle.freeIO(output);
  }
}

/**
 * Smallest interior angle across all triangles, in degrees.
 * Used as the headline mesh-quality diagnostic (Phase 2 completion criterion
 * requires ≥ 25°).
 */
function computeMinAngleDeg(vertices: Float64Array, triangles: Int32Array): number {
  let minRad = Math.PI;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i]!;
    const b = triangles[i + 1]!;
    const c = triangles[i + 2]!;
    const ax = vertices[2 * a]!;
    const ay = vertices[2 * a + 1]!;
    const bx = vertices[2 * b]!;
    const by = vertices[2 * b + 1]!;
    const cx = vertices[2 * c]!;
    const cy = vertices[2 * c + 1]!;

    minRad = Math.min(
      minRad,
      angleAt(ax, ay, bx, by, cx, cy),
      angleAt(bx, by, cx, cy, ax, ay),
      angleAt(cx, cy, ax, ay, bx, by),
    );
  }
  return (minRad * 180) / Math.PI;
}

/** Angle [rad] at the first vertex of a triangle, given all three coordinates. */
function angleAt(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const d1x = x1 - x0;
  const d1y = y1 - y0;
  const d2x = x2 - x0;
  const d2y = y2 - y0;
  const cosA = (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y));
  return Math.acos(Math.max(-1, Math.min(1, cosA)));
}
