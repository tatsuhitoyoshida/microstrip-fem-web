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

import { selectRefinementSeeds } from './adaptiveRefine';
import { assembleK, type EpsilonRForRegion } from './assembly';
import { applyDirichletElimination } from './boundary';
import { capacitancePerLength } from './capacitance';
import { SPEED_OF_LIGHT } from './constants';
import { computeElementErrorIndicators } from './errorIndicator';
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

export interface AdaptiveOptions {
  /**
   * Convergence tolerance on |Z₀_n − Z₀_{n−1}| [Ω]. Default 0.05 Ω
   * (matches the bisection convergence target in §6 Phase 5).
   */
  tolerance?: number;
  /**
   * Hard cap on adaptive passes. Default 20. The triangle-wasm 16 MB heap
   * (~60 k tri practical ceiling) usually halts growth several passes
   * before this cap, so 20 is a "loose" upper bound — it lets tight
   * tolerances run as far as the heap allows without the user re-tuning.
   */
  maxPasses?: number;
  /**
   * Fraction of triangles refined per pass (top-η²). Default 0.25
   * (HFSS-like Refinement-Per-Pass).
   */
  refineFraction?: number;
  /**
   * Stop refining once the next mesh would exceed this triangle count.
   * Default 250 000 — comfortable headroom under the rebuilt triangle-wasm
   * (`-s ALLOW_MEMORY_GROWTH=1, MAXIMUM_MEMORY=512MB`) which can mesh up
   * to ~300 k triangles before Triangle bails out internally. The adaptive
   * loop also catches that internal failure and treats it as 'triangleCeiling'.
   */
  triangleCeiling?: number;
}

/** One row of the adaptive convergence history table. */
export interface AdaptivePassInfo {
  /** 0-indexed pass number. */
  pass: number;
  triangleCount: number;
  /** Z₀ from this pass [Ω]. */
  z0: number;
  /** ε_eff from this pass [-]. */
  epsilonEff: number;
  /** |Z₀_n − Z₀_{n−1}| [Ω], NaN for pass 0. */
  deltaZ0: number;
}

/**
 * Why the adaptive loop terminated. Exposed in the result so the UI can
 * tell the user "it stopped because the heap is full, not because Z₀
 * converged" — important when the requested tolerance is tighter than
 * what the triangle-wasm 16 MB heap can resolve.
 */
export type AdaptiveStopReason =
  | 'converged' // |ΔZ₀| < tolerance
  | 'maxPasses' // user-supplied pass cap hit
  | 'triangleCeiling' // would exceed the WASM-heap-derived triangle ceiling
  | 'noRefinementCandidates'; // every η² == 0 (very rare)

export interface MicrostripSolveOptions {
  geometry?: GeometryOptions;
  mesh?: MeshOptions;
  /** CG residual tolerance for both solves. Default 1e-10. */
  cgTolerance?: number;
  /**
   * If set, run the adaptive refinement loop instead of a single pass.
   * `solveMicrostripAdaptive` reads this; `solveMicrostrip` ignores it.
   */
  adaptive?: AdaptiveOptions;
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
  /**
   * Per-pass diagnostics when run via `solveMicrostripAdaptive`. Length
   * equals the number of completed passes (≥ 1). Undefined for non-adaptive
   * solves.
   */
  passes?: AdaptivePassInfo[];
  /**
   * Why the adaptive loop stopped. Undefined for non-adaptive solves.
   * 'converged' is the only "happy" outcome — the others mean the user
   * asked for tighter accuracy than the loop could deliver.
   */
  stopReason?: AdaptiveStopReason;
}

/** εr lookup for the dielectric solve (substrate → params.epsilonR, air → 1). */
function makeDielectricEpsR(epsilonR: number): EpsilonRForRegion {
  return (attr) => {
    if (attr === RegionAttr.Substrate) return epsilonR;
    if (attr === RegionAttr.Air) return 1;
    throw new Error(`solveMicrostrip: unknown region attribute ${attr}`);
  };
}

/**
 * Solve a single microstrip configuration on a fixed mesh derived from
 * `options.geometry` / `options.mesh`. Used both as the report-quality solve
 * after bisection and as the inner step of `solveMicrostripAdaptive`.
 *
 * `options.adaptive` is ignored here; call `solveMicrostripAdaptive` if you
 * want the iterative refinement loop.
 */
export function solveMicrostrip(
  params: MicrostripParams,
  options: MicrostripSolveOptions = {},
): MicrostripSolveResult {
  const { pslg, bounds } = buildMicrostripPslg(params, options.geometry);
  const mesh = meshFromPslg(pslg, options.mesh);
  return solveOnMesh(mesh, params, bounds, options.cgTolerance ?? 1e-10);
}

/** Internal: run the two FEM solves on an already-built mesh. */
function solveOnMesh(
  mesh: Mesh,
  params: MicrostripParams,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  cgTol: number,
): MicrostripSolveResult {
  // --- Solve 1: with dielectric (substrate ε_r, air ε_r = 1) → C ---
  const epsR = makeDielectricEpsR(params.epsilonR);
  const Kc = assembleK(mesh, epsR);
  const KcSolve = cloneCsr(Kc);
  const { rhs: rhsC } = applyDirichletElimination(KcSolve, mesh, microstripDirichlet);
  const solC = solveCgJacobi(KcSolve, rhsC, { tol: cgTol });
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
  const solV = solveCgJacobi(KvSolve, rhsV, { tol: cgTol });
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

/**
 * Coarse starting mesh for the adaptive loop. Drops the per-region triangle
 * targets to ~5 k initial triangles so we have headroom for 4–5 refinement
 * passes under the triangle-wasm heap ceiling.
 */
function adaptiveInitialGeometry(user: GeometryOptions | undefined): GeometryOptions {
  const out: GeometryOptions = { ...(user ?? {}) };
  // Pick safe coarse defaults *only* when the caller didn't already specify.
  // FR-4 reference: substrate 1.6 mm × ~36 mm ≈ 58 mm² → 58/1500 ≈ 0.04 mm²
  // gives ~1.5 k substrate triangles; air ~3 k. Total ~4.5 k.
  if (out.substrateMaxArea === undefined) out.substrateMaxArea = 0.04;
  if (out.airMaxArea === undefined) out.airMaxArea = 0.4;
  return out;
}

/**
 * Adaptive Z₀ / ε_eff solve. Iterates {build → solve → estimate error →
 * insert centroid Steiner points → re-mesh} until ΔZ₀ falls below
 * tolerance, the maxPasses cap is hit, or the next mesh would exceed the
 * triangle-count ceiling.
 *
 * Returns the same shape as `solveMicrostrip` but with `passes` populated.
 *
 * The error indicator (`errorIndicator.ts`) uses the dielectric-solve φ —
 * it's the more physically interesting field and refining for it is a
 * superset of refining for the vacuum solve.
 */
export function solveMicrostripAdaptive(
  params: MicrostripParams,
  options: MicrostripSolveOptions = {},
  onPass?: (info: AdaptivePassInfo, passResult: MicrostripSolveResult) => void,
): MicrostripSolveResult {
  const adaptive = options.adaptive ?? {};
  const tolerance = adaptive.tolerance ?? 0.05;
  const maxPasses = adaptive.maxPasses ?? 20;
  const refineFraction = adaptive.refineFraction ?? 0.25;
  const triangleCeiling = adaptive.triangleCeiling ?? 250000;
  const cgTol = options.cgTolerance ?? 1e-10;

  const initialGeometry = adaptiveInitialGeometry(options.geometry);

  // Accumulator of all extra Steiner points fed back into the geometry.
  const extraPoints: Array<[number, number]> = [];
  const passes: AdaptivePassInfo[] = [];

  let lastResult: MicrostripSolveResult | null = null;
  let lastZ0 = NaN;
  let stopReason: AdaptiveStopReason = 'maxPasses';

  for (let pass = 0; pass < maxPasses; pass++) {
    const geometry: GeometryOptions = {
      ...initialGeometry,
      extraPoints: extraPoints.slice(),
    };
    let pslg, bounds, mesh;
    try {
      ({ pslg, bounds } = buildMicrostripPslg(params, geometry));
      mesh = meshFromPslg(pslg, options.mesh);
    } catch (err) {
      // Triangle-wasm sometimes fails on extremely large refinements
      // (returning null pointlist). Treat it identically to hitting the
      // user-supplied ceiling: keep the last good result and stop.
      if (lastResult) {
        stopReason = 'triangleCeiling';
        break;
      }
      throw err;
    }

    const passResult = solveOnMesh(mesh, params, bounds, cgTol);
    const deltaZ0 = pass === 0 ? Number.NaN : Math.abs(passResult.z0 - lastZ0);
    const info: AdaptivePassInfo = {
      pass,
      triangleCount: mesh.triangleCount,
      z0: passResult.z0,
      epsilonEff: passResult.epsilonEff,
      deltaZ0,
    };
    passes.push(info);
    onPass?.(info, passResult);

    lastResult = passResult;
    lastZ0 = passResult.z0;

    // Convergence check — but always keep the first pass as a warm-up.
    if (pass > 0 && deltaZ0 < tolerance) {
      stopReason = 'converged';
      break;
    }
    if (pass === maxPasses - 1) {
      stopReason = 'maxPasses';
      break;
    }
    if (mesh.triangleCount >= triangleCeiling) {
      stopReason = 'triangleCeiling';
      break;
    }

    // Compute error indicator on the dielectric solve and pick refinement
    // seeds. The next pass's mesh ingests these as Steiner points.
    const epsR = makeDielectricEpsR(params.epsilonR);
    const eta2 = computeElementErrorIndicators(mesh, passResult.phi, epsR);
    const seeds = selectRefinementSeeds(mesh, eta2, { fraction: refineFraction });
    if (seeds.length === 0) {
      stopReason = 'noRefinementCandidates';
      break;
    }
    extraPoints.push(...seeds);
  }

  if (!lastResult) {
    // Should be unreachable — the loop always runs at least once.
    throw new Error('solveMicrostripAdaptive: produced no result');
  }
  return { ...lastResult, passes, stopReason };
}
