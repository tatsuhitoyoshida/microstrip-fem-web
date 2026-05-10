/**
 * Geometric and material parameters of a single-ended microstrip line.
 * All length quantities must share the same unit (e.g. all in mm or all in m);
 * Z₀ is scale-invariant under uniform rescaling.
 */
export interface MicrostripParams {
  /** Trace (signal conductor) width */
  width: number;
  /** Substrate thickness (height between trace and ground) */
  height: number;
  /** Conductor thickness (set to 0 for ideal zero-thickness conductor) */
  thickness: number;
  /** Relative permittivity of the substrate dielectric */
  epsilonR: number;
}

/**
 * Result of a microstrip Z₀ / ε_eff calculation.
 */
export interface MicrostripResult {
  /** Characteristic impedance Z₀ [Ω] */
  z0: number;
  /** Effective relative permittivity ε_eff [-] */
  epsilonEff: number;
}

/**
 * Boundary marker tags used for points and segments in the PSLG.
 * Triangle preserves these on output; the FEM solver later reads them to
 * apply Dirichlet conditions (conductor / ground / outer) and identifies the
 * dielectric interface for diagnostics.
 */
// Markers are ordered so that, when Triangle has to pick a single marker for
// a vertex shared by multiple boundaries, the higher absolute value wins
// (per the Triangle docs). Conductor must therefore beat
// DielectricInterface — otherwise the conductor corners that sit on the
// substrate–air line would lose their φ = V_drive condition.
export const Marker = {
  /** No special boundary (interior). Triangle's default. */
  Interior: 0,
  /** Substrate–air dielectric interface; no Dirichlet BC. */
  DielectricInterface: 1,
  /** Outer (truncation) boundary, treated as φ = 0 (∞ approximation). */
  OuterBoundary: 2,
  /** Ground plane at the bottom of the substrate (φ = 0). */
  Ground: 3,
  /** Conductor surface (signal trace), φ = V_drive (1 V by convention). */
  Conductor: 4,
} as const;
export type MarkerValue = (typeof Marker)[keyof typeof Marker];

/**
 * Region attribute values written to triangle.triangleattributelist.
 * Each generated triangle inherits the attribute of its enclosing region,
 * letting `assembly.ts` look up ε_r per element.
 */
export const RegionAttr = {
  Substrate: 1,
  Air: 2,
} as const;
export type RegionAttrValue = (typeof RegionAttr)[keyof typeof RegionAttr];

/**
 * Planar Straight-Line Graph — flat-array form expected by triangle-wasm.
 * All coordinate quantities are in the same length unit as MicrostripParams.
 */
export interface Pslg {
  /** [x0, y0, x1, y1, ...] — vertex coordinates */
  pointlist: number[];
  /** Marker per vertex (length = pointlist.length / 2) */
  pointmarkerlist: number[];
  /** [i0, j0, i1, j1, ...] — vertex-index pairs forming PSLG segments */
  segmentlist: number[];
  /** Marker per segment (length = segmentlist.length / 2) */
  segmentmarkerlist: number[];
  /** [x0, y0, x1, y1, ...] — one interior point per hole */
  holelist: number[];
  /** [x, y, attr, maxArea, ...] — 4 floats per region */
  regionlist: number[];
}

/**
 * Triangulated mesh in plain JS-array form (decoupled from triangle-wasm
 * heap views). `assembly.ts` consumes this directly.
 */
export interface Mesh {
  /** [x0, y0, x1, y1, ...] — node coordinates */
  vertices: Float64Array;
  /** [v0, v1, v2, v0, v1, v2, ...] — 0-based vertex indices, 3 per triangle */
  triangles: Int32Array;
  /** Region attribute per triangle (RegionAttr value) */
  triangleAttributes: Float64Array;
  /** Marker per vertex (Marker value) */
  vertexMarkers: Int32Array;
  /**
   * Triangle-adjacency: for triangle t, neighbors of edge opposite vertex k
   * are stored at neighborList[3*t + k]. Boundary edges yield -1.
   * Populated when the mesh was generated with `neighbors: true`.
   */
  neighborList: Int32Array;
  /** Diagnostics: minimum interior angle of any triangle [deg] */
  minAngleDeg: number;
  /** Diagnostics: number of triangles */
  triangleCount: number;
}
