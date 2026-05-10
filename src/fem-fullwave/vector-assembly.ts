/**
 * Global assembly of edge-DoF (Nédélec) operator matrices for the
 * vector-Helmholtz path (Round 8c Stage 2).
 *
 * This module turns the per-triangle 3×3 element matrices from
 * `nedelec.ts` into edge-indexed sparse matrices over the whole mesh,
 * threading in the orientation signs from `edge-dofs.ts`. Each edge has
 * one DoF, so the result is `numEdges × numEdges` symmetric CSR.
 *
 * The two natural operators on the vector E_t field:
 *
 *   - **Vector mass** M_tt:   ∫_Ω α(x,y) N_i · N_j dA
 *   - **Curl-curl**  K_tt:    ∫_Ω α(x,y) (∇×N_i)·(∇×N_j) dA
 *
 * with `α` a per-triangle scalar (typically µr⁻¹ for stiffness and
 * εr for mass, but we keep them generic here so the Helmholtz layer
 * can plug in whatever weights its formulation needs).
 *
 * The orientation sign-flip `sr * sc` in the inner loop is what makes
 * the global Nédélec basis well-defined: each interior edge is visited
 * by two triangles whose local edge tangents point in opposite
 * directions, and the signs cancel out so the global basis functions
 * cross element boundaries continuously.
 *
 * Tests live in `tests/fem-fullwave/vector-assembly.test.ts`.
 */

import type { TriangleWeight } from './assembly';
import type { EdgeTopology } from './edge-dofs';
import { CooBuilder, type CsrMatrix } from '../fem/sparse';
import {
  elementCurlCurl,
  elementVectorMass,
  triangleGeom,
} from './nedelec';
import type { Mesh } from '../types';

/** Pull (x, y) for vertex `i` out of the flat `vertices` array. */
function vertexXY(mesh: Mesh, i: number): [number, number] {
  return [mesh.vertices[2 * i]!, mesh.vertices[2 * i + 1]!];
}

/**
 * Assemble the edge-DoF vector mass matrix
 *
 *     (M_tt)_{ij}  =  ∫_Ω α · N_i · N_j  dA
 *
 * where N_i is the (oriented) global Whitney 1-form for edge i and α is
 * the per-triangle scalar weight returned by `weight(regionAttr)`.
 */
export function assembleEdgeMass(
  mesh: Mesh,
  topology: EdgeTopology,
  weight: TriangleWeight,
): CsrMatrix {
  const builder = new CooBuilder(topology.numEdges);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const [x0, y0] = vertexXY(mesh, v0);
    const [x1, y1] = vertexXY(mesh, v1);
    const [x2, y2] = vertexXY(mesh, v2);
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);
    const alpha = weight(mesh.triangleAttributes[t]!);
    const Me = elementVectorMass(geom);

    for (let r = 0; r < 3; r++) {
      const er = topology.tri2edge[3 * t + r]!;
      const sr = topology.tri2edgeSign[3 * t + r]!;
      for (let c = 0; c < 3; c++) {
        const ec = topology.tri2edge[3 * t + c]!;
        const sc = topology.tri2edgeSign[3 * t + c]!;
        builder.add(er, ec, alpha * sr * sc * Me[r]![c]!);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Assemble the edge-DoF curl-curl stiffness matrix
 *
 *     (K_tt)_{ij}  =  ∫_Ω α · (∇×N_i) · (∇×N_j)  dA
 *
 * The local 3×3 contributions come from `elementCurlCurl` and pick up
 * the same orientation `sr * sc` flip that the mass matrix needs.
 *
 * Note that K_tt is **rank-deficient** by design: any curl-free vector
 * field (e.g. ∇φ for some scalar φ) is in its null space. That's
 * physically correct — gradient fields don't propagate, and the
 * Helmholtz mass term breaks the degeneracy when present.
 */
export function assembleEdgeCurlCurl(
  mesh: Mesh,
  topology: EdgeTopology,
  weight: TriangleWeight,
): CsrMatrix {
  const builder = new CooBuilder(topology.numEdges);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const [x0, y0] = vertexXY(mesh, v0);
    const [x1, y1] = vertexXY(mesh, v1);
    const [x2, y2] = vertexXY(mesh, v2);
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);
    const alpha = weight(mesh.triangleAttributes[t]!);
    const Ke = elementCurlCurl(geom);

    for (let r = 0; r < 3; r++) {
      const er = topology.tri2edge[3 * t + r]!;
      const sr = topology.tri2edgeSign[3 * t + r]!;
      for (let c = 0; c < 3; c++) {
        const ec = topology.tri2edge[3 * t + c]!;
        const sc = topology.tri2edgeSign[3 * t + c]!;
        builder.add(er, ec, alpha * sr * sc * Ke[r]![c]!);
      }
    }
  }
  return builder.toCsr();
}

/**
 * DoF representation of a uniform vector field `E = (Ex, Ey)` in the
 * Nédélec space. Each edge DoF is the line integral of E along the
 * edge in its global tangent direction:
 *
 *     dof_e  =  ∫_{edge_e}  E · t̂_e  dl  =  E · (v_hi − v_lo)
 *
 * (since E is constant). Useful for unit tests — e.g. K_tt · dof =
 * 0 because curl of a constant is zero.
 */
export function uniformFieldDofs(
  mesh: Mesh,
  topology: EdgeTopology,
  Ex: number,
  Ey: number,
): Float64Array {
  const dofs = new Float64Array(topology.numEdges);
  for (let e = 0; e < topology.numEdges; e++) {
    const vLo = topology.edgeVertices[2 * e]!;
    const vHi = topology.edgeVertices[2 * e + 1]!;
    const [xLo, yLo] = vertexXY(mesh, vLo);
    const [xHi, yHi] = vertexXY(mesh, vHi);
    dofs[e] = Ex * (xHi - xLo) + Ey * (yHi - yLo);
  }
  return dofs;
}
