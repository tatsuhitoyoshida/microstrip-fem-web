// @vitest-environment node
/**
 * Phase 3 completion test: a true parallel-plate capacitor in vacuum.
 *
 * Domain: rectangle [-W/2, W/2] × [0, h], with
 *   bottom edge  (y = 0)   → ground   (φ = 0)
 *   top edge     (y = h)   → conductor (φ = 1)
 *   left/right edges       → unconstrained (Neumann, naturally enforced)
 *
 * Single dielectric region with εr = 1. The exact analytical solution is
 *   φ(x,y) = y/h     (linear, capturable exactly by linear T3 elements)
 *   C/L    = ε₀ · W / h     [F/m]
 *
 * Linear triangles can represent the exact solution, so we expect the
 * recovered φᵀKφ to equal W/h (dimensionless) to within penalty/CG round-off.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { initMesh, meshFromPslg } from '../src/fem/mesh';
import { assembleK } from '../src/fem/assembly';
import { applyDirichletElimination } from '../src/fem/boundary';
import { capacitancePerLength, quadraticForm } from '../src/fem/capacitance';
import { cloneCsr } from '../src/fem/sparse';
import { solveCgJacobi } from '../src/fem/solver';
import { EPSILON_0 } from '../src/fem/constants';
import { Marker, type Pslg, RegionAttr } from '../src/types';

const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

/** Build a parallel-plate PSLG. Side walls are Marker.Interior (Neumann). */
function buildParallelPlatePslg(width: number, height: number, maxArea: number): Pslg {
  const halfW = width / 2;
  return {
    pointlist: [-halfW, 0, halfW, 0, halfW, height, -halfW, height],
    pointmarkerlist: [Marker.Ground, Marker.Ground, Marker.Conductor, Marker.Conductor],
    segmentlist: [0, 1, 1, 2, 2, 3, 3, 0],
    segmentmarkerlist: [
      Marker.Ground,
      Marker.Interior, // right wall
      Marker.Conductor,
      Marker.Interior, // left wall
    ],
    holelist: [],
    regionlist: [0, height / 2, RegionAttr.Air, maxArea],
  };
}

const dirichletForMicrostripMarker = (marker: number): number | null => {
  if (marker === Marker.Conductor) return 1;
  if (marker === Marker.Ground || marker === Marker.OuterBoundary) return 0;
  return null;
};

const epsilonRForRegion = (attr: number): number => {
  if (attr === RegionAttr.Substrate) return 4.4; // unused in this test
  if (attr === RegionAttr.Air) return 1;
  throw new Error(`unknown region attribute: ${attr}`);
};

describe('Phase 3 — parallel-plate capacitor (vacuum)', () => {
  beforeAll(async () => {
    await initMesh(WASM_PATH);
  });

  it('reproduces C = ε₀ · W / h within 1 %', () => {
    const W = 100; // [mm]
    const h = 1; // [mm]
    const pslg = buildParallelPlatePslg(W, h, 0.5);
    const mesh = meshFromPslg(pslg, { minAngleDeg: 25 });
    expect(mesh.minAngleDeg).toBeGreaterThanOrEqual(25);

    const Kfree = assembleK(mesh, epsilonRForRegion);
    const K = cloneCsr(Kfree);
    const { rhs } = applyDirichletElimination(K, mesh, dirichletForMicrostripMarker);

    const { x: phi, converged, iterations } = solveCgJacobi(K, rhs, { tol: 1e-12 });
    expect(converged).toBe(true);
    expect(iterations).toBeGreaterThan(0);

    // Spot-check φ ≈ y/h at every node.
    for (let i = 0; i < mesh.vertices.length / 2; i++) {
      const y = mesh.vertices[2 * i + 1]!;
      expect(phi[i]).toBeCloseTo(y / h, 6);
    }

    // The dimensionless quadratic form should equal W/h exactly for T3.
    const qf = quadraticForm(Kfree, phi);
    expect(qf).toBeCloseTo(W / h, 4);

    const C = capacitancePerLength(Kfree, phi); // [F · mm / mm] = [F · (mm of length-axis)]
    // Our PSLG length unit is mm; converting to m means dividing W and h by
    // 1e3. The W/h ratio is unitless, so C in F/(unit length) is identical
    // whether we compute in mm or m. Compare directly to ε₀ · W / h.
    const Cexact = EPSILON_0 * (W / h); // [F / m] (or per any consistent length)
    expect(Math.abs(C - Cexact) / Cexact).toBeLessThan(0.01); // 1 %
  });

  it('linear-φ reconstruction holds even on a coarse mesh', () => {
    const W = 10;
    const h = 1;
    const pslg = buildParallelPlatePslg(W, h, 0.5);
    const mesh = meshFromPslg(pslg);
    const Kfree = assembleK(mesh, epsilonRForRegion);
    const K = cloneCsr(Kfree);
    const { rhs } = applyDirichletElimination(K, mesh, dirichletForMicrostripMarker);
    const { x: phi } = solveCgJacobi(K, rhs);
    // qf should equal W / h regardless of mesh density (T3 captures linear φ
    // exactly).
    const qf = quadraticForm(Kfree, phi);
    expect(qf).toBeCloseTo(W / h, 4);
  });
});
