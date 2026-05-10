// @vitest-environment node
/**
 * Discrete-gradient operator G and gradient deflator (Vector Stage 2.3b).
 *
 * The test plan mirrors `vector-assembly.test.ts`: we use the same
 * 2-triangle unit-square mesh so the topology is small enough to inspect
 * by hand if anything goes wrong. The validations cover the core
 * algebraic properties of `(G, P_perp)`:
 *
 *   1. **Shape and sparsity**: G is `numEdges × numNodes` with exactly
 *      two non-zeros (±1) per row.
 *
 *   2. **G annihilates the constant nodal vector**: G · 1 = 0. This is
 *      the discrete equivalent of "gradient of a constant is zero".
 *
 *   3. **Discrete curl–grad identity**: `K_curl · (G f) = 0` to FP
 *      round-off for arbitrary nodal `f`. This is the *exact* discrete
 *      analogue of `∇ × ∇φ ≡ 0`, and the property that motivates the
 *      whole edge-element / Whitney 1-form construction.
 *
 *   4. **Deflator removes pure gradients**: P_perp(G f) ≈ 0 for any
 *      nodal f.
 *
 *   5. **Idempotency**: P_perp(P_perp v) ≈ P_perp v.
 *
 *   6. **M-orthogonality of the residual**: (G f)ᵀ M (P_perp v) = 0 for
 *      every nodal f, i.e. the projected vector has no component along
 *      *any* gradient mode. This is the practical guarantee we need
 *      before plugging the deflator into shift-invert MINRES.
 */

import { describe, expect, it } from 'vitest';
import { buildEdgeTopology } from '../../src/fem-fullwave/edge-dofs';
import {
  assembleEdgeCurlCurl,
  assembleEdgeMass,
} from '../../src/fem-fullwave/vector-assembly';
import {
  assembleDiscreteGradient,
  buildGradientDeflator,
} from '../../src/fem-fullwave/gradient';
import { spmv } from '../../../src/fem/sparse';
import type { Mesh } from '../../../src/types';

/** Same 2-triangle unit square as vector-assembly.test.ts. */
function unitSquareMesh(): Mesh {
  return {
    vertices: Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    triangles: Int32Array.from([0, 1, 2, 0, 2, 3]),
    triangleAttributes: new Float64Array(2),
    vertexMarkers: new Int32Array(4),
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: 2,
  };
}

/**
 * 4×3 structured rectangular mesh for stress-testing the deflator on
 * something larger than a single element. 12 nodes, ~13 triangles, ~24
 * edges — small enough to brute-force inspect, big enough that the
 * gradient subspace is non-trivial.
 */
function rectangularMesh(nx: number, ny: number, lx: number, ly: number): Mesh {
  const numNodes = nx * ny;
  const verts = new Float64Array(2 * numNodes);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      verts[2 * n] = (i * lx) / (nx - 1);
      verts[2 * n + 1] = (j * ly) / (ny - 1);
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = j * nx + i + 1;
      const c = (j + 1) * nx + i;
      const d = (j + 1) * nx + i + 1;
      tris.push(a, b, d);
      tris.push(a, d, c);
    }
  }
  return {
    vertices: verts,
    triangles: Int32Array.from(tris),
    triangleAttributes: new Float64Array(tris.length / 3),
    vertexMarkers: new Int32Array(numNodes),
    neighborList: new Int32Array(0),
    minAngleDeg: 45,
    triangleCount: tris.length / 3,
  };
}

describe('Discrete gradient G', () => {
  it('has shape (numEdges × numNodes) with exactly two ±1 entries per row', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);

    expect(G.numRows).toBe(topo.numEdges);
    expect(G.numCols).toBe(mesh.vertices.length / 2);

    for (let e = 0; e < G.numRows; e++) {
      const start = G.rowPtr[e]!;
      const end = G.rowPtr[e + 1]!;
      expect(end - start).toBe(2);
      let sum = 0;
      let absSum = 0;
      for (let k = start; k < end; k++) {
        sum += G.values[k]!;
        absSum += Math.abs(G.values[k]!);
      }
      expect(sum).toBe(0); // -1 and +1 cancel
      expect(absSum).toBe(2);
    }
  });

  it('annihilates the constant nodal field (G·1 = 0)', () => {
    const mesh = unitSquareMesh();
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const ones = new Float64Array(mesh.vertices.length / 2).fill(1);
    const Gones = spmv(G, ones);
    for (const v of Gones) expect(v).toBe(0);
  });

  it('satisfies the discrete curl–grad identity K_curl·(G f) = 0 for arbitrary nodal f', () => {
    // The Whitney 1-form construction makes (curl ∘ grad) zero exactly,
    // not just approximately. Try a few unrelated nodal fields.
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const K = assembleEdgeCurlCurl(mesh, topo, () => 1);

    const numNodes = mesh.vertices.length / 2;
    const trials: Float64Array[] = [
      // Linear in x: f_n = x_n
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) => mesh.vertices[2 * n]!),
      ),
      // Linear in y: f_n = y_n
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) => mesh.vertices[2 * n + 1]!),
      ),
      // Pseudo-random
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) =>
          Math.sin(7 * n + 1.3) * 5 - Math.cos(3 * n - 0.4) * 2,
        ),
      ),
    ];

    for (const f of trials) {
      const grad = spmv(G, f);
      const Kgrad = spmv(K, grad);
      // |K (G f)| should be FP zero relative to |grad|.
      let scale = 0;
      for (const v of grad) scale = Math.max(scale, Math.abs(v));
      const tol = 1e-10 * Math.max(scale, 1);
      for (const v of Kgrad) expect(Math.abs(v)).toBeLessThan(tol);
    }
  });
});

describe('Gradient deflator P_perp', () => {
  it('annihilates pure gradients: P_perp(G f) ≈ 0', () => {
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const deflator = buildGradientDeflator(G, M);

    const numNodes = mesh.vertices.length / 2;
    const f = Float64Array.from(
      Array.from({ length: numNodes }, (_, n) => 0.3 * n - Math.sin(n)),
    );
    const Gf = spmv(G, f);
    const projected = deflator.project(Gf);
    let maxAbs = 0;
    for (const v of projected) maxAbs = Math.max(maxAbs, Math.abs(v));
    // Compared against |Gf| this should be deep into round-off.
    let scale = 0;
    for (const v of Gf) scale = Math.max(scale, Math.abs(v));
    expect(maxAbs).toBeLessThan(1e-9 * Math.max(scale, 1));
  });

  it('is idempotent: P_perp(P_perp v) ≈ P_perp v', () => {
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const deflator = buildGradientDeflator(G, M);

    // Arbitrary edge-DoF vector, mixing both gradient and curl content.
    const v = Float64Array.from(
      Array.from({ length: topo.numEdges }, (_, i) =>
        Math.cos(0.7 * i) + 0.5 * Math.sin(1.1 * i + 2),
      ),
    );
    const p1 = deflator.project(v);
    const p2 = deflator.project(p1);
    for (let i = 0; i < p1.length; i++) {
      expect(p2[i]!).toBeCloseTo(p1[i]!, 9);
    }
  });

  it('the residual is M-orthogonal to every gradient direction', () => {
    // (G f)ᵀ M (P_perp v) = 0 for all nodal f. Test on a few independent
    // directions — that's enough since linearity propagates.
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const deflator = buildGradientDeflator(G, M);
    const numNodes = mesh.vertices.length / 2;

    // An arbitrary edge-space vector to project.
    const v = Float64Array.from(
      Array.from({ length: topo.numEdges }, (_, i) =>
        2 + Math.cos(0.4 * i + 1) - 0.3 * Math.sin(0.9 * i),
      ),
    );
    const p = deflator.project(v);
    const Mp = spmv(M, p);

    const trialNodals: Float64Array[] = [
      // Coordinate-aligned probes
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) => mesh.vertices[2 * n]!),
      ),
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) => mesh.vertices[2 * n + 1]!),
      ),
      // Random-ish
      Float64Array.from(
        Array.from({ length: numNodes }, (_, n) =>
          Math.sin(2.7 * n) * 3 + Math.cos(0.5 * n + 1.3),
        ),
      ),
    ];

    for (const f of trialNodals) {
      const Gf = spmv(G, f);
      let inner = 0;
      for (let i = 0; i < Gf.length; i++) inner += Gf[i]! * Mp[i]!;
      // Compare against |Gf|·|Mp| as a scale.
      let normGf = 0;
      let normMp = 0;
      for (let i = 0; i < Gf.length; i++) {
        normGf += Gf[i]! * Gf[i]!;
        normMp += Mp[i]! * Mp[i]!;
      }
      const scale = Math.sqrt(normGf * normMp);
      expect(Math.abs(inner)).toBeLessThan(1e-9 * Math.max(scale, 1));
    }
  });

  it('respects pinnedNodes when the gradient subspace lives on a sub-domain', () => {
    // Closed-domain analogue: if every boundary node is "pinned" (think
    // PEC-fixed), the gradient subspace is generated by interior nodal
    // fields only. P_perp built with that pinning should still
    // M-orthogonalise the result against gradients of *any* such field.
    const mesh = rectangularMesh(4, 3, 2, 1);
    const topo = buildEdgeTopology(mesh);
    const G = assembleDiscreteGradient(topo, mesh.vertices.length / 2);
    const M = assembleEdgeMass(mesh, topo, () => 1);
    const numNodes = mesh.vertices.length / 2;

    // Pin all corner / edge nodes (= mesh boundary in this structured grid).
    const isBoundary = (n: number): boolean => {
      const x = mesh.vertices[2 * n]!;
      const y = mesh.vertices[2 * n + 1]!;
      return x === 0 || x === 2 || y === 0 || y === 1;
    };
    const pinned: number[] = [];
    for (let n = 0; n < numNodes; n++) {
      if (isBoundary(n)) pinned.push(n);
    }
    const deflator = buildGradientDeflator(G, M, { pinnedNodes: pinned });

    // Pick a nodal scalar that vanishes on the boundary (the only kind
    // of f for which "G f is in the deflator's null space" applies).
    const f = new Float64Array(numNodes);
    for (let n = 0; n < numNodes; n++) {
      if (!isBoundary(n)) f[n] = 1.7; // single interior bump
    }
    const Gf = spmv(G, f);
    const projected = deflator.project(Gf);
    let maxAbs = 0;
    let scale = 0;
    for (const v of Gf) scale = Math.max(scale, Math.abs(v));
    for (const v of projected) maxAbs = Math.max(maxAbs, Math.abs(v));
    expect(maxAbs).toBeLessThan(1e-9 * Math.max(scale, 1));
  });
});
