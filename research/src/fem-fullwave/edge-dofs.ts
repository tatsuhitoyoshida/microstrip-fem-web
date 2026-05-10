/**
 * Edge enumeration + orientation for Nédélec (edge) finite elements.
 *
 * Vector Maxwell on a triangulated 2-D cross-section needs degrees of
 * freedom on **edges** rather than vertices: the tangential component
 * of E along each edge is the natural DoF for curl-conforming elements.
 * This module turns a vertex-based mesh into an edge-indexed view:
 *
 *   - every interior edge appears in exactly two triangles
 *   - every boundary edge appears in exactly one triangle
 *   - each edge is given a single global tangent direction (low-vertex
 *     → high-vertex), so basis functions are unambiguous
 *   - per triangle we record the local-edge-to-global-edge map plus
 *     ±1 sign that says whether the triangle's local traversal agrees
 *     with the global tangent
 *
 * Convention: triangle vertices are stored as (v0, v1, v2). The local
 * edge **opposite** vertex k goes from vertex (k+1) mod 3 to vertex
 * (k+2) mod 3. This is the convention Whitney 1-form formulae assume,
 * and it falls out cleanly of barycentric-coordinate identities.
 *
 * Reference:
 *   J. Jin, "The Finite Element Method in Electromagnetics" (3rd ed.)
 *   §8.4 — Edge elements on triangles, edge enumeration, orientation.
 */

import type { Mesh } from '../../../src/types';

export interface EdgeTopology {
  /** Number of unique edges in the mesh. */
  numEdges: number;
  /**
   * Length 2·numEdges. For edge e, `edgeVertices[2*e]` is the lower-
   * indexed endpoint and `edgeVertices[2*e + 1]` the higher one. The
   * tangent of edge e by definition runs from the lower to the higher.
   */
  edgeVertices: Int32Array;
  /**
   * Length 3·triangleCount. For triangle t, the global edge index of
   * its local edge k (= the edge opposite vertex k) is
   * `tri2edge[3*t + k]`.
   */
  tri2edge: Int32Array;
  /**
   * Length 3·triangleCount. ±1 sign telling whether triangle t's
   * local edge k traverses the global edge in the same direction as
   * the global tangent (+1) or the opposite (-1). The Whitney 1-form
   * basis function is multiplied by this sign when assembling.
   */
  tri2edgeSign: Int8Array;
}

/**
 * Build the edge-DoF view of a triangle mesh.
 *
 * O(numTriangles) time, O(numEdges) space. The Map keyed by a packed
 * (minV, maxV) integer is hot-loop friendly — for ~50 k triangles the
 * whole pass takes a few ms in V8.
 */
export function buildEdgeTopology(mesh: Mesh): EdgeTopology {
  const numTri = mesh.triangleCount;
  const numNodes = mesh.vertices.length / 2;

  // Pack (minV, maxV) into a single number for Map keys. Number is
  // safe up to 2^53; for numNodes < 2^26 (= 67 M) this is fine.
  const pack = (a: number, b: number): number => a * numNodes + b;

  const edgeMap = new Map<number, number>();
  const tri2edge = new Int32Array(3 * numTri);
  const tri2edgeSign = new Int8Array(3 * numTri);
  const edgeV0: number[] = [];
  const edgeV1: number[] = [];

  for (let t = 0; t < numTri; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const verts: [number, number, number] = [v0, v1, v2];

    for (let k = 0; k < 3; k++) {
      // Local edge k goes from vertex (k+1)%3 to vertex (k+2)%3.
      const a = verts[(k + 1) % 3]!;
      const b = verts[(k + 2) % 3]!;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const sign = a === lo ? 1 : -1;

      const key = pack(lo, hi);
      let idx = edgeMap.get(key);
      if (idx === undefined) {
        idx = edgeV0.length;
        edgeMap.set(key, idx);
        edgeV0.push(lo);
        edgeV1.push(hi);
      }
      tri2edge[3 * t + k] = idx;
      tri2edgeSign[3 * t + k] = sign;
    }
  }

  const numEdges = edgeV0.length;
  const edgeVertices = new Int32Array(2 * numEdges);
  for (let i = 0; i < numEdges; i++) {
    edgeVertices[2 * i] = edgeV0[i]!;
    edgeVertices[2 * i + 1] = edgeV1[i]!;
  }

  return { numEdges, edgeVertices, tri2edge, tri2edgeSign };
}

/**
 * Set of edges that touch a boundary vertex marker (= part of the PEC
 * outer truncation or interior conductor surface). Used by the
 * vector-Helmholtz assembly to enforce `n × E_t = 0` on PEC, which in
 * Nédélec land means setting the tangential edge DoFs to zero.
 *
 * An edge is treated as a PEC edge if **both** its endpoints carry a
 * non-zero vertex marker. This catches the cases:
 *
 *   - both vertices on the outer PEC box → outer boundary
 *   - both vertices on the signal conductor → inner conductor edge
 *
 * but not edges that merely have one PEC vertex incidentally (e.g. an
 * interior edge ending on the substrate-air interface that touches the
 * outer box at one corner).
 */
export function findPecEdges(
  topology: EdgeTopology,
  mesh: Mesh,
  isPecMarker: (marker: number) => boolean,
): Int32Array {
  const result: number[] = [];
  for (let e = 0; e < topology.numEdges; e++) {
    const v0 = topology.edgeVertices[2 * e]!;
    const v1 = topology.edgeVertices[2 * e + 1]!;
    if (
      isPecMarker(mesh.vertexMarkers[v0]!) &&
      isPecMarker(mesh.vertexMarkers[v1]!)
    ) {
      result.push(e);
    }
  }
  return Int32Array.from(result);
}
