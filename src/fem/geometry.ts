/**
 * Build a Planar Straight-Line Graph (PSLG) for the 2-D microstrip cross
 * section, ready to feed into triangle-wasm.
 *
 * Coordinate system:
 *   y = 0          ground plane (Dirichlet, φ = 0)
 *   0 < y < h      substrate (ε_r region)
 *   y = h          substrate–air interface
 *   h ≤ y ≤ h+t    conductor (signal trace) — modelled as a hole, with its
 *                  boundary tagged as a Dirichlet surface (φ = V_drive)
 *   y > h+t        air (ε_r = 1 region)
 *   x ∈ [-L/2, L/2] outer truncation box, padded laterally by
 *                   `lateralPaddingFactor × h` on each side of the trace
 *                   (default 10 → total domain width = W + 20 h).
 *   y ∈ [0, H]     vertical extent, with `airPaddingFactor × h` of air above
 *                   the conductor (default 10).
 *
 * The conductor is centred at x = 0.  The outer left, right and top edges,
 * together with the ground plane, are all treated as φ = 0 in the FEM stage.
 */

import { Marker, RegionAttr, type MicrostripParams, type Pslg } from '../types';

export interface GeometryOptions {
  /** Lateral domain padding on each side of the trace, in units of h. Default 10. */
  lateralPaddingFactor?: number;
  /** Air column above the conductor, in units of h. Default 10. */
  airPaddingFactor?: number;
  /** Per-region max triangle area for the substrate. Default: heuristic. */
  substrateMaxArea?: number;
  /** Per-region max triangle area for the air region. Default: heuristic. */
  airMaxArea?: number;
  /**
   * Extra Steiner points to insert into the PSLG before triangulation.
   * Each entry is [x, y]; the marker is set to Interior so Triangle treats
   * them as ordinary refinement seeds. Used by the adaptive loop to force
   * refinement near elements with high error indicators.
   */
  extraPoints?: ReadonlyArray<readonly [number, number]>;
}

export interface BuiltGeometry {
  pslg: Pslg;
  /** Outer bounding box of the computational domain. */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

/** Default ratios used when no per-region area constraint is supplied.
 *  Tuned to ~40 k triangles on the standard FR-4 case — the practical
 *  ceiling allowed by the upstream triangle-wasm 16 MB heap (see
 *  `mesh.ts`). With the Phase 8 Web Worker the resulting ~600 ms solve
 *  does not block the UI; bisection still uses a coarse override
 *  (see `femWorker.ts`) to stay sub-second. */
const DEFAULT_SUBSTRATE_TRIANGLE_TARGET = 12000;
const DEFAULT_AIR_TRIANGLE_TARGET = 24000;

export function buildMicrostripPslg(
  params: MicrostripParams,
  options: GeometryOptions = {},
): BuiltGeometry {
  const { width: W, height: h, thickness: t } = params;
  if (W <= 0 || h <= 0 || t < 0) {
    throw new Error('buildMicrostripPslg: width and height must be > 0 and thickness ≥ 0');
  }

  const lateralPad = options.lateralPaddingFactor ?? 10;
  const airPad = options.airPaddingFactor ?? 10;
  const halfL = W / 2 + lateralPad * h;
  const xMin = -halfL;
  const xMax = halfL;
  const yMin = 0;
  const yMax = h + t + airPad * h;

  const pointlist: number[] = [];
  const pointmarkerlist: number[] = [];

  const addPoint = (x: number, y: number, marker: number): number => {
    const idx = pointlist.length / 2;
    pointlist.push(x, y);
    pointmarkerlist.push(marker);
    return idx;
  };

  // --- outer box vertices (split at y = h on the left and right edges) ---
  const blGround = addPoint(xMin, yMin, Marker.Ground);
  const brGround = addPoint(xMax, yMin, Marker.Ground);
  const rightAtH = addPoint(xMax, h, Marker.OuterBoundary);
  const trOuter = addPoint(xMax, yMax, Marker.OuterBoundary);
  const tlOuter = addPoint(xMin, yMax, Marker.OuterBoundary);
  const leftAtH = addPoint(xMin, h, Marker.OuterBoundary);

  // --- conductor corners (centred about x = 0) ---
  const halfW = W / 2;
  const cBL = addPoint(-halfW, h, Marker.Conductor);
  const cBR = addPoint(halfW, h, Marker.Conductor);
  const cTR = addPoint(halfW, h + t, Marker.Conductor);
  const cTL = addPoint(-halfW, h + t, Marker.Conductor);

  const segmentlist: number[] = [];
  const segmentmarkerlist: number[] = [];
  const addSegment = (i: number, j: number, marker: number): void => {
    segmentlist.push(i, j);
    segmentmarkerlist.push(marker);
  };

  // outer perimeter
  addSegment(blGround, brGround, Marker.Ground); // ground (bottom)
  addSegment(brGround, rightAtH, Marker.OuterBoundary); // right (lower half)
  addSegment(rightAtH, trOuter, Marker.OuterBoundary); // right (upper half)
  addSegment(trOuter, tlOuter, Marker.OuterBoundary); // top
  addSegment(tlOuter, leftAtH, Marker.OuterBoundary); // left (upper half)
  addSegment(leftAtH, blGround, Marker.OuterBoundary); // left (lower half)

  // substrate–air interface (the y = h line, excluding the conductor footprint)
  addSegment(leftAtH, cBL, Marker.DielectricInterface);
  addSegment(cBR, rightAtH, Marker.DielectricInterface);

  // conductor boundary (4 sides of the W × t rectangle)
  addSegment(cBL, cBR, Marker.Conductor); // bottom
  addSegment(cBR, cTR, Marker.Conductor); // right
  addSegment(cTR, cTL, Marker.Conductor); // top
  addSegment(cTL, cBL, Marker.Conductor); // left

  // Adaptive refinement points: tag as Interior so Triangle treats them as
  // ordinary Steiner seeds. They must lie strictly inside the substrate or
  // air region (caller's responsibility — the adaptive selector enforces
  // this via triangle-centroid sampling of the previous mesh).
  if (options.extraPoints) {
    for (const [px, py] of options.extraPoints) {
      addPoint(px, py, Marker.Interior);
    }
  }

  // hole flood-fill seed inside the conductor (Triangle removes triangles
  // reachable from this point that are bounded by PSLG segments).
  const holelist = t > 0 ? [0, h + t / 2] : [];

  // region markers — one interior point per material region, with the area
  // constraint following each (x, y, attr).
  const substrateAreaTotal = (xMax - xMin) * h;
  const airAreaTotal = (xMax - xMin) * (yMax - h) - W * t;
  const substrateMaxArea =
    options.substrateMaxArea ?? substrateAreaTotal / DEFAULT_SUBSTRATE_TRIANGLE_TARGET;
  const airMaxArea = options.airMaxArea ?? airAreaTotal / DEFAULT_AIR_TRIANGLE_TARGET;
  const regionlist = [
    0,
    h / 2,
    RegionAttr.Substrate,
    substrateMaxArea,
    0,
    h + t + (yMax - h - t) / 2,
    RegionAttr.Air,
    airMaxArea,
  ];

  return {
    pslg: { pointlist, pointmarkerlist, segmentlist, segmentmarkerlist, holelist, regionlist },
    bounds: { xMin, xMax, yMin, yMax },
  };
}
