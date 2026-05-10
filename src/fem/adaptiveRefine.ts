/**
 * Adaptive refinement seed selector.
 *
 * Given a mesh and per-triangle error indicators η_T², this picks the top
 * `fraction` of triangles by error and returns their centroids as new
 * Steiner seed points. The next adaptive pass feeds these into
 * `buildMicrostripPslg(..., { extraPoints })` and re-triangulates the whole
 * domain. Triangle's own quality constraint (min angle ≥ 25°) handles the
 * surrounding cleanup automatically — we don't need local subdivision.
 *
 * Centroid insertion is the simplest stable refinement strategy: each new
 * point splits its enclosing triangle into roughly three, and Triangle adds
 * its own Steiner points if needed to keep angles within bound. Per-pass
 * triangle-count growth stays bounded enough that 4–5 passes fit under the
 * triangle-wasm 16 MB heap (~60 k tri ceiling).
 */

import { triangleCentroid } from './errorIndicator';
import type { Mesh } from '../types';

export interface RefinementOptions {
  /**
   * Fraction of triangles, ranked by η², to refine each pass. HFSS default
   * is ~0.25–0.30; we use 0.25.
   */
  fraction?: number;
  /**
   * Hard cap on the number of new seed points emitted, regardless of
   * fraction. Lets the caller throttle growth when we are close to the
   * heap ceiling.
   */
  maxSeeds?: number;
}

/**
 * Return centroid coordinates of the top-`fraction` triangles by η².
 *
 * Triangles with η² = 0 are filtered out (no value in refining a region
 * where every adjacent edge already has zero D-jump).
 */
export function selectRefinementSeeds(
  mesh: Mesh,
  eta2: Float64Array,
  options: RefinementOptions = {},
): Array<[number, number]> {
  const fraction = options.fraction ?? 0.25;
  if (fraction <= 0 || fraction > 1) {
    throw new Error(`selectRefinementSeeds: fraction must be in (0, 1], got ${fraction}`);
  }

  const nTri = mesh.triangleCount;
  if (eta2.length !== nTri) {
    throw new Error(`selectRefinementSeeds: eta2 length ${eta2.length} ≠ triangleCount ${nTri}`);
  }

  // Index list, descending by η².
  const indices: number[] = [];
  for (let t = 0; t < nTri; t++) {
    if (eta2[t]! > 0) indices.push(t);
  }
  indices.sort((a, b) => eta2[b]! - eta2[a]!);

  const targetCount = Math.max(1, Math.ceil(nTri * fraction));
  const cap = options.maxSeeds ?? targetCount;
  const k = Math.min(targetCount, cap, indices.length);

  const seeds: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) {
    const t = indices[i]!;
    const [x, y] = triangleCentroid(mesh, t);
    seeds.push([x, y]);
  }
  return seeds;
}
