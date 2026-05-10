/**
 * Per-element error indicator for adaptive mesh refinement.
 *
 * For T3 elements ∇φ is constant inside each triangle, so D = -ε_r ε₀ ∇φ
 * is also piecewise constant. The exact solution has continuous normal D
 * across material interfaces and inside each region; the discrete solution
 * does not. The size of the normal-D jump across an edge therefore measures
 * how poorly the local mesh resolves the field.
 *
 * Classical edge residual estimator (Zienkiewicz–Zhu / Babuška–Rheinboldt):
 *
 *   η_e² = h_e · ‖ [εr ∇φ · n] ‖²
 *   η_T² = sum of η_e² over the 3 edges of T (interior edges only;
 *           Dirichlet/Neumann boundary edges contribute 0).
 *
 * The ε₀ factor is ignored because it is constant across the mesh and
 * cancels when we rank elements by η_T². Likewise we drop the per-edge
 * coefficient (1/2) typically seen in residual estimators — it shifts every
 * η² by the same factor and therefore does not change the ranking.
 *
 * The estimator naturally fires at:
 *   - the substrate–air interface (where εr jumps and the discrete D_n
 *     jump tracks the discretisation error of the interface),
 *   - conductor edges (singularities, ∇φ → ∞),
 *   - any region of strong field gradient.
 */

import type { Mesh } from '../types';

/**
 * Compute the per-triangle error indicator η_T² for a nodal potential φ.
 *
 * @param mesh   triangulation; must include `neighborList` (mesh.ts always
 *               supplies it now).
 * @param phi    nodal potential, length = numVertices.
 * @param epsilonRForRegion  same callback signature as `assembleK`.
 *               Used both for the per-element D computation and as the
 *               weight in the jump.
 */
export function computeElementErrorIndicators(
  mesh: Mesh,
  phi: Float64Array,
  epsilonRForRegion: (regionAttr: number) => number,
): Float64Array {
  const nTri = mesh.triangleCount;
  if (mesh.neighborList.length !== 3 * nTri) {
    throw new Error(
      `computeElementErrorIndicators: neighborList length ${mesh.neighborList.length} ≠ 3·${nTri}`,
    );
  }

  // Pre-compute (Ex, Ey, εr) for every triangle. Reuse across the edge loop
  // so each element's gradient is built only once.
  // E = -∇φ = -(Σ_i b_i φ_i, Σ_i c_i φ_i), with b_i = (y_j-y_k)/(2A),
  //                                              c_i = (x_k-x_j)/(2A).
  const ex = new Float64Array(nTri);
  const ey = new Float64Array(nTri);
  const epsR = new Float64Array(nTri);
  const cx = new Float64Array(nTri); // centroid x
  const cy = new Float64Array(nTri); // centroid y

  for (let t = 0; t < nTri; t++) {
    const i0 = mesh.triangles[3 * t]!;
    const i1 = mesh.triangles[3 * t + 1]!;
    const i2 = mesh.triangles[3 * t + 2]!;

    const x0 = mesh.vertices[2 * i0]!;
    const y0 = mesh.vertices[2 * i0 + 1]!;
    const x1 = mesh.vertices[2 * i1]!;
    const y1 = mesh.vertices[2 * i1 + 1]!;
    const x2 = mesh.vertices[2 * i2]!;
    const y2 = mesh.vertices[2 * i2 + 1]!;

    const twoA = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const inv2A = 1 / twoA;
    const b0 = (y1 - y2) * inv2A;
    const b1 = (y2 - y0) * inv2A;
    const b2 = (y0 - y1) * inv2A;
    const c0 = (x2 - x1) * inv2A;
    const c1 = (x0 - x2) * inv2A;
    const c2 = (x1 - x0) * inv2A;

    const phi0 = phi[i0]!;
    const phi1 = phi[i1]!;
    const phi2 = phi[i2]!;

    // ∇φ is constant on T3
    const gradPhiX = b0 * phi0 + b1 * phi1 + b2 * phi2;
    const gradPhiY = c0 * phi0 + c1 * phi1 + c2 * phi2;

    // E = -∇φ
    ex[t] = -gradPhiX;
    ey[t] = -gradPhiY;
    epsR[t] = epsilonRForRegion(mesh.triangleAttributes[t]!);
    cx[t] = (x0 + x1 + x2) / 3;
    cy[t] = (y0 + y1 + y2) / 3;
  }

  // Edge loop: in T3 with vertices (i0, i1, i2), the edge opposite vertex k
  // has neighborList[3*t + k] as its across-the-edge neighbor (or -1 if
  // boundary). To avoid double-counting, we accumulate the edge contribution
  // to *both* triangles when t < neighbor, and skip otherwise.
  const eta2 = new Float64Array(nTri);

  for (let t = 0; t < nTri; t++) {
    const i0 = mesh.triangles[3 * t]!;
    const i1 = mesh.triangles[3 * t + 1]!;
    const i2 = mesh.triangles[3 * t + 2]!;
    const verts: [number, number, number] = [i0, i1, i2];

    for (let k = 0; k < 3; k++) {
      const tn = mesh.neighborList[3 * t + k]!;
      // boundary edge → no jump term (Dirichlet/Neumann handled separately
      // and outer truncation is far enough that we ignore it).
      if (tn < 0) continue;
      // count each interior edge once (when t is the smaller index)
      if (tn < t) continue;

      // Edge endpoints are the two vertices of triangle t other than k.
      const va = verts[(k + 1) % 3]!;
      const vb = verts[(k + 2) % 3]!;
      const ax = mesh.vertices[2 * va]!;
      const ay = mesh.vertices[2 * va + 1]!;
      const bx = mesh.vertices[2 * vb]!;
      const by = mesh.vertices[2 * vb + 1]!;
      const ex_x = bx - ax;
      const ex_y = by - ay;
      const hEdge = Math.hypot(ex_x, ex_y);
      if (hEdge === 0) continue;

      // Edge normal: perpendicular to edge vector, unit length. Direction
      // (left vs right) is irrelevant because we square the dot product.
      const nx = ex_y / hEdge;
      const ny = -ex_x / hEdge;

      // ‖[εr E · n]‖² across the edge.
      const dnL = epsR[t]! * (ex[t]! * nx + ey[t]! * ny);
      const dnR = epsR[tn]! * (ex[tn]! * nx + ey[tn]! * ny);
      const jump = dnL - dnR;
      const contrib = hEdge * jump * jump;

      eta2[t] = eta2[t]! + contrib;
      eta2[tn] = eta2[tn]! + contrib;
    }
  }

  return eta2;
}

/** Triangle centroid at index t (used by the refinement selector). */
export function triangleCentroid(mesh: Mesh, t: number): readonly [number, number] {
  const i0 = mesh.triangles[3 * t]!;
  const i1 = mesh.triangles[3 * t + 1]!;
  const i2 = mesh.triangles[3 * t + 2]!;
  return [
    (mesh.vertices[2 * i0]! + mesh.vertices[2 * i1]! + mesh.vertices[2 * i2]!) / 3,
    (mesh.vertices[2 * i0 + 1]! + mesh.vertices[2 * i1 + 1]! + mesh.vertices[2 * i2 + 1]!) / 3,
  ];
}
