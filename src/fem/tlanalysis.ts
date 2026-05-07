/**
 * Transmission-line parameters (Z₀, ε_eff) for a quasi-TEM microstrip,
 * computed from the FEM capacitances. The full pipeline orchestrated here
 * performs two FEM solves: one with the dielectric in place (yielding C),
 * and one in vacuum (εr ← 1 everywhere, yielding C₀).
 *
 * Standard quasi-static identities (CLAUDE.md §7.6):
 *
 *   L     = μ₀ε₀ / C₀
 *   Z₀    = √(L / C) = 1 / (c · √(C · C₀))
 *   ε_eff = C / C₀
 *
 * where c is the speed of light in vacuum.
 */

import { assembleK, type EpsilonRForRegion } from './assembly';
import { applyDirichletElimination } from './boundary';
import { capacitancePerLength } from './capacitance';
import { SPEED_OF_LIGHT } from './constants';
import { buildMicrostripPslg, type GeometryOptions } from './geometry';
import { meshFromPslg, type MeshOptions } from './mesh';
import { cloneCsr } from './sparse';
import { solveCgJacobi } from './solver';
import { Marker, type Mesh, type MicrostripParams, RegionAttr } from '../types';

/** Z₀ [Ω] from the per-length capacitances C [F/m] and C₀ [F/m]. */
export function characteristicImpedance(c: number, c0: number): number {
  return 1 / (SPEED_OF_LIGHT * Math.sqrt(c * c0));
}

/** ε_eff = C / C₀. */
export function effectivePermittivity(c: number, c0: number): number {
  return c / c0;
}

/** Microstrip BC mapping: conductor → 1 V, ground & outer truncation → 0 V. */
const microstripDirichlet = (marker: number): number | null => {
  if (marker === Marker.Conductor) return 1;
  if (marker === Marker.Ground || marker === Marker.OuterBoundary) return 0;
  return null;
};

export interface MicrostripSolveOptions {
  geometry?: GeometryOptions;
  mesh?: MeshOptions;
  /** CG residual tolerance for both solves. Default 1e-10. */
  cgTolerance?: number;
}

export interface MicrostripSolveResult {
  /** Characteristic impedance [Ω]. */
  z0: number;
  /** Effective relative permittivity [-]. */
  epsilonEff: number;
  /** Per-length capacitance with the dielectric in place [F/m]. */
  c: number;
  /** Per-length capacitance with εr ≡ 1 everywhere [F/m]. */
  c0: number;
  triangleCount: number;
  cgIterations: { withDielectric: number; vacuum: number };
  /** Triangulated cross-section mesh (vertices, triangles, markers). */
  mesh: Mesh;
  /** Nodal potential φ for the dielectric solve (length = numVertices). */
  phi: Float64Array;
  /** Nodal potential φ for the vacuum solve. */
  phiVacuum: Float64Array;
  /** Outer bounding box of the computational domain. */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

/**
 * Run the full Phase 2-4 pipeline (geometry → mesh → assemble → solve →
 * extract C, C₀ → Z₀, ε_eff) for a single microstrip configuration.
 */
export function solveMicrostrip(
  params: MicrostripParams,
  options: MicrostripSolveOptions = {},
): MicrostripSolveResult {
  const { pslg, bounds } = buildMicrostripPslg(params, options.geometry);
  const mesh = meshFromPslg(pslg, options.mesh);
  const tol = options.cgTolerance ?? 1e-10;

  // --- Solve 1: with dielectric (substrate ε_r, air ε_r = 1) → C ---
  const epsR: EpsilonRForRegion = (attr) => {
    if (attr === RegionAttr.Substrate) return params.epsilonR;
    if (attr === RegionAttr.Air) return 1;
    throw new Error(`solveMicrostrip: unknown region attribute ${attr}`);
  };
  const Kc = assembleK(mesh, epsR);
  const KcSolve = cloneCsr(Kc);
  const { rhs: rhsC } = applyDirichletElimination(KcSolve, mesh, microstripDirichlet);
  const solC = solveCgJacobi(KcSolve, rhsC, { tol });
  if (!solC.converged) {
    throw new Error(
      `solveMicrostrip: CG (dielectric) failed to converge — relRes=${solC.relResidual}`,
    );
  }
  const c = capacitancePerLength(Kc, solC.x);

  // --- Solve 2: vacuum everywhere (εr ≡ 1) → C₀ ---
  const epsRVacuum: EpsilonRForRegion = () => 1;
  const Kv = assembleK(mesh, epsRVacuum);
  const KvSolve = cloneCsr(Kv);
  const { rhs: rhsV } = applyDirichletElimination(KvSolve, mesh, microstripDirichlet);
  const solV = solveCgJacobi(KvSolve, rhsV, { tol });
  if (!solV.converged) {
    throw new Error(`solveMicrostrip: CG (vacuum) failed to converge — relRes=${solV.relResidual}`);
  }
  const c0 = capacitancePerLength(Kv, solV.x);

  return {
    z0: characteristicImpedance(c, c0),
    epsilonEff: effectivePermittivity(c, c0),
    c,
    c0,
    triangleCount: mesh.triangleCount,
    cgIterations: { withDielectric: solC.iterations, vacuum: solV.iterations },
    mesh,
    phi: solC.x,
    phiVacuum: solV.x,
    bounds,
  };
}
