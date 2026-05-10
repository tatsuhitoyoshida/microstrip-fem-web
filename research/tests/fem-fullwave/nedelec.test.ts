// @vitest-environment node
/**
 * Unit tests for the Nédélec edge-element building blocks (Vector Stage 1.1–1.2).
 *
 * Two layers of pin:
 *
 *  1. Edge enumeration & orientation (`edge-dofs.ts`):
 *     - Edge count for known meshes
 *     - Each interior edge is shared by exactly two triangles, and the
 *       two visits carry opposite orientation signs (otherwise the
 *       global tangent isn't well-defined).
 *     - PEC edge selection picks up edges whose endpoints both carry
 *       the supplied marker.
 *
 *  2. Element matrices (`nedelec.ts`):
 *     - Curl-curl on the canonical right triangle (vertices (0,0), (1,0),
 *       (0,1)) matches the closed-form values that you can compute by
 *       hand from the gradient identities.
 *     - Vector mass is symmetric.
 *     - Both matrices scale correctly when the triangle is uniformly
 *       scaled by a factor s — curl-curl stays the same (curl is 1/A,
 *       integrand is curl² · A, so dimension-less of s) while mass
 *       scales as s² (linear coords squared cancel against 1/A in
 *       gradients differently).
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology, findPecEdges } from '../../src/fem-fullwave/edge-dofs';
import {
  edgeCurl,
  elementCurlCurl,
  elementVectorMass,
  triangleGeom,
} from '../../src/fem-fullwave/nedelec';
import type { Mesh } from '../../../src/types';

/** Two-triangle quadrilateral: (0,0)-(1,0)-(1,1)-(0,1) split along (0,0)-(1,1). */
function squareMesh(): Mesh {
  return {
    vertices: Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    triangles: Int32Array.from([0, 1, 2, 0, 2, 3]),
    triangleAttributes: new Float64Array(2),
    vertexMarkers: new Int32Array(4), // none marked
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: 2,
  };
}

describe('Nedelec Stage 1.1 — edge enumeration', () => {
  it('counts unique edges in a 2-triangle square (4 boundary + 1 shared = 5)', () => {
    const topo = buildEdgeTopology(squareMesh());
    expect(topo.numEdges).toBe(5);
    expect(topo.tri2edge.length).toBe(6);
    expect(topo.tri2edgeSign.length).toBe(6);
  });

  it('every interior edge is referenced by two triangles with opposite signs', () => {
    const topo = buildEdgeTopology(squareMesh());
    // Tally how many triangles claim each edge.
    const visits: { tri: number; localEdge: number; sign: number }[][] = Array.from(
      { length: topo.numEdges },
      () => [],
    );
    for (let t = 0; t < 2; t++) {
      for (let k = 0; k < 3; k++) {
        const e = topo.tri2edge[3 * t + k]!;
        const s = topo.tri2edgeSign[3 * t + k]!;
        visits[e]!.push({ tri: t, localEdge: k, sign: s });
      }
    }
    let interiorCount = 0;
    for (const v of visits) {
      if (v.length === 2) {
        interiorCount += 1;
        // Two visits to an interior edge must traverse it in opposite
        // local directions, because the two triangles share the edge
        // but lie on opposite sides.
        expect(v[0]!.sign * v[1]!.sign).toBe(-1);
      } else {
        expect(v.length).toBe(1); // boundary edge
      }
    }
    // 1 interior edge in this 2-triangle square.
    expect(interiorCount).toBe(1);
  });

  it('global tangent always runs from low-index vertex to high-index', () => {
    const topo = buildEdgeTopology(squareMesh());
    for (let e = 0; e < topo.numEdges; e++) {
      const v0 = topo.edgeVertices[2 * e]!;
      const v1 = topo.edgeVertices[2 * e + 1]!;
      expect(v0).toBeLessThan(v1);
    }
  });

  it('findPecEdges picks edges with both endpoints flagged', () => {
    const mesh = squareMesh();
    // Mark vertices 0 and 1 (the bottom edge of the square) as PEC.
    mesh.vertexMarkers = Int32Array.from([1, 1, 0, 0]);
    const topo = buildEdgeTopology(mesh);
    const pec = findPecEdges(topo, mesh, (m) => m === 1);
    // Only the (0,1) edge has both endpoints marked.
    expect(pec.length).toBe(1);
    const e = pec[0]!;
    const v0 = topo.edgeVertices[2 * e]!;
    const v1 = topo.edgeVertices[2 * e + 1]!;
    expect([v0, v1].sort()).toEqual([0, 1]);
  });
});

describe('Nedelec Stage 1.2 — element matrices', () => {
  /** Reference triangle: (0,0), (1,0), (0,1). Area = 1/2. */
  const ref = (): ReturnType<typeof triangleGeom> => triangleGeom(0, 0, 1, 0, 0, 1);

  it('reference triangle has area 1/2 and the expected gradient pattern', () => {
    const g = ref();
    expect(g.area).toBeCloseTo(0.5, 12);
    // λ_0(x,y) = 1 − x − y → ∇λ_0 = (−1, −1)
    // λ_1(x,y) = x         → ∇λ_1 = (1, 0)
    // λ_2(x,y) = y         → ∇λ_2 = (0, 1)
    expect(g.bs[0]).toBeCloseTo(-1, 12);
    expect(g.cs[0]).toBeCloseTo(-1, 12);
    expect(g.bs[1]).toBeCloseTo(1, 12);
    expect(g.cs[1]).toBeCloseTo(0, 12);
    expect(g.bs[2]).toBeCloseTo(0, 12);
    expect(g.cs[2]).toBeCloseTo(1, 12);
  });

  it('edge curls are constants with magnitude 2 on the reference triangle', () => {
    const g = ref();
    // For our convention curl N_k = 2 (b_a c_b − b_b c_a).
    // k=0 (a=1, b=2): 2(b1 c2 − b2 c1) = 2(1·1 − 0·0) = 2
    // k=1 (a=2, b=0): 2(b2 c0 − b0 c2) = 2(0·(−1) − (−1)·1) = 2
    // k=2 (a=0, b=1): 2(b0 c1 − b1 c0) = 2((−1)·0 − 1·(−1)) = 2
    expect(edgeCurl(g, 0)).toBeCloseTo(2, 12);
    expect(edgeCurl(g, 1)).toBeCloseTo(2, 12);
    expect(edgeCurl(g, 2)).toBeCloseTo(2, 12);
  });

  it('curl-curl matrix is the constant outer product on the reference triangle', () => {
    const K = elementCurlCurl(ref());
    // All curls equal 2, area = 0.5 → every entry = 2 * 2 * 0.5 = 2.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(K[i]![j]).toBeCloseTo(2, 12);
      }
    }
  });

  it('vector mass matrix is symmetric on the reference triangle', () => {
    const M = elementVectorMass(ref());
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(M[i]![j]).toBeCloseTo(M[j]![i]!, 12);
      }
    }
  });

  it('curl-curl scales as 1/s², mass is invariant under uniform scaling', () => {
    // Scale the reference triangle by s (right-angle, vertices
    // (0,0), (s,0), (0,s)). Whitney 1-form theory + dimensional analysis:
    //   ∇λ has units 1/length, so curl N = 2(b_a c_b − b_b c_a) has
    //   units 1/length² and (curl N)² · A has units 1/length². Stiffness
    //   therefore scales as 1/s².
    //   N_k = λ ∇λ has units 1/length, |N_k|² has units 1/length², and
    //   ∫|N|² dA over area length² is dimensionless. Mass is invariant.
    const s = 3;
    const K0 = elementCurlCurl(ref());
    const M0 = elementVectorMass(ref());
    const K1 = elementCurlCurl(triangleGeom(0, 0, s, 0, 0, s));
    const M1 = elementVectorMass(triangleGeom(0, 0, s, 0, 0, s));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(K1[i]![j]).toBeCloseTo(K0[i]![j]! / (s * s), 10);
        expect(M1[i]![j]).toBeCloseTo(M0[i]![j]!, 10);
      }
    }
  });
});
