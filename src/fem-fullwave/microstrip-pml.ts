/**
 * Microstrip cross-section PML integration (Round 8c Stage 3a-vi-b).
 *
 * Full pipeline from a `MicrostripParams` description (W, h, t, ε_r)
 * + frequency to a propagation-constant eigenvalue β². Wraps:
 *
 *   buildMicrostripPslg                   — substrate / conductor /
 *                                            outer-box geometry
 *   meshFromPslg                          — triangle-wasm meshing
 *   buildEdgeTopology                     — Nédélec edge enumeration
 *   solveMixedSystemPml                   — full PML mixed-system solve
 *
 * The PML config is derived from the geometry's lateral / air
 * padding factors. By default we put the PML zone in the **outer
 * half** of each padding band, leaving the inner half as a buffer
 * so the bound mode's evanescent tail isn't truncated by the PML
 * before it has decayed.
 *
 * The shift σ for shift-invert defaults to `k₀² · ε_eff(KJ-static)`
 * — a closed-form quasi-static estimate that lands within a few
 * percent of the dominant quasi-TEM β² at most frequencies of
 * interest. Callers in tests can override.
 *
 * **Length-scale convention**: all lengths in the input
 * `MicrostripParams` share one unit (typically mm). The
 * `frequencyGHz` is converted to k₀ in 1/mm internally
 * (`k₀ = 2π · f / c` with c in mm/s for mm-based geometry).
 * Eigenvalue β² is reported in 1/mm² to stay consistent.
 */

import {
  buildMicrostripPslg,
  type GeometryOptions,
} from '../fem/geometry';
import { initMesh, meshFromPslg } from '../fem/mesh';
import { hammerstadJensen } from '../analytical/hammerstad';
import { Marker, type MicrostripParams, RegionAttr } from '../types';
import { buildEdgeTopology } from './edge-dofs';
import {
  solveMixedSystemPml,
  type PmlEigensolveResult,
} from './pml-eigensolve';
import {
  identityProfile1D,
  noPml,
  polynomialPmlProfile1D,
  type Pml2D,
} from './pml';
import type { Complex } from './complex-sparse';

/** Speed of light in mm/s, for converting f [GHz] → k₀ [1/mm]. */
const C_MM_PER_S = 2.998e11;

export interface MicrostripPmlOptions {
  /** Operating frequency [GHz]. */
  frequencyGHz: number;
  /** Mesh / geometry overrides — same shape as the static FEM path's
   *  `solveMicrostrip` options. */
  geometry?: GeometryOptions;
  /**
   * PML configuration. If omitted, a default polynomial-taper PML is
   * placed in the outer half of each padding band on the top + lateral
   * truncations (the bottom is the PEC ground, no PML).
   *
   * Pass `noPml()` to run with PEC truncation only — useful as a
   * baseline / regression check.
   */
  pml?: Pml2D;
  /** Maximum κ in the polynomial PML profile. Default 5 — empirically
   *  a good trade-off between absorption strength and inner-boundary
   *  reflection at the FEM grids we use. Ignored when `pml` is given. */
  pmlKappaMax?: number;
  /** Polynomial taper order. Default 2 (quadratic). Ignored when `pml`
   *  is given. */
  pmlOrder?: number;
  /**
   * Shift-invert target σ. If omitted, defaults to
   * `k₀² · ε_eff(KJ-static)` so the eigsolver locks onto the
   * dominant quasi-TEM mode.
   */
  shift?: Complex;
  /** Inner BiCGStab tolerance. Default 1e-10. */
  innerTol?: number;
  /** Outer eigenvalue tolerance. Default 1e-8. */
  outerTol?: number;
  /** Outer iteration cap. Default 200. */
  outerMaxIter?: number;
  /** Inner Bi-CGSTAB cap (per inner solve). Default 4·n. Larger
   *  values help on the ill-conditioned shifted operators that show
   *  up at low frequency where σ ≈ 0 in the natural matrix scale. */
  innerMaxIter?: number;
  /**
   * Override the URL passed to `initMesh`. Tests pass the file:// path
   * to the local `triangle.out.wasm`; production uses the default. The
   * loader is idempotent — calling more than once is harmless.
   */
  wasmUrl?: string;
}

export interface MicrostripPmlResult extends PmlEigensolveResult {
  /** k₀² used for the solve, in 1/mm². */
  k0Squared: number;
  /** Quasi-static ε_eff(KJ) used to seed the shift, for diagnostics. */
  epsEffSeed: number;
  /** β² as 2-tuple (matches `Complex` from `complex-sparse.ts`). */
  beta2: Complex;
  /** β = √β² (principal branch, Re ≥ 0). */
  beta: Complex;
  /** Mesh / topology kept around for downstream Z₀ extraction. */
  mesh: ReturnType<typeof meshFromPslg>;
  topology: ReturnType<typeof buildEdgeTopology>;
}

/**
 * Construct the default PML configuration for a microstrip box of
 * the given outer bounds. Places PML in the outer half of each
 * padding band on the top + lateral edges; the bottom is PEC.
 */
export function defaultMicrostripPml(
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  params: MicrostripParams,
  kappaMax = 5,
  order = 2,
): Pml2D {
  const { width: W, height: h, thickness: t } = params;
  // Inner physical region: ±(W/2 + 5h) on x, [0, h+t+5h] on y.
  // PML zone covers the outer ~half of the padding band on each side.
  const xInner = W / 2 + 5 * h;
  const yInner = h + t + 5 * h;
  const xProfile =
    bounds.xMax > xInner
      ? polynomialPmlProfile1D({
          innerLo: -xInner,
          innerHi: xInner,
          outerLo: bounds.xMin,
          outerHi: bounds.xMax,
          kappaMax,
          order,
        })
      : identityProfile1D();
  const yProfile =
    bounds.yMax > yInner
      ? polynomialPmlProfile1D({
          innerLo: bounds.yMin - 1, // never engages on the bottom
          innerHi: yInner,
          outerLo: bounds.yMin - 1,
          outerHi: bounds.yMax,
          kappaMax,
          order,
        })
      : identityProfile1D();
  return { x: xProfile, y: yProfile };
}

/** PEC predicate for the standard microstrip markers. The dielectric
 *  interface is *not* PEC (it's a natural BC in the weak form). */
function isMicrostripPec(marker: number): boolean {
  return (
    marker === Marker.Ground ||
    marker === Marker.Conductor ||
    marker === Marker.OuterBoundary
  );
}

/**
 * End-to-end microstrip PML solve at a given frequency. Returns the
 * propagation constant β² of the dominant quasi-TEM mode plus the
 * mesh / eigenvector data downstream Z₀ extraction needs.
 *
 * Async because triangle-wasm initialisation is async.
 */
export async function solveMicrostripPml(
  params: MicrostripParams,
  options: MicrostripPmlOptions,
): Promise<MicrostripPmlResult> {
  if (params.epsilonR < 1) {
    throw new Error('solveMicrostripPml: ε_r must be ≥ 1');
  }
  if (options.frequencyGHz <= 0) {
    throw new Error('solveMicrostripPml: frequencyGHz must be > 0');
  }

  // 1. Build geometry + mesh.
  const { pslg, bounds } = buildMicrostripPslg(params, options.geometry ?? {});
  if (options.wasmUrl !== undefined) {
    await initMesh(options.wasmUrl);
  } else {
    await initMesh();
  }
  const mesh = meshFromPslg(pslg);
  const topology = buildEdgeTopology(mesh);

  // 2. Frequency parameter k₀² in 1/mm² (lengths in mm).
  const k0 = (2 * Math.PI * options.frequencyGHz * 1e9) / C_MM_PER_S;
  const k0Squared = k0 * k0;

  // 3. PML config (default places it in the outer half of the
  // geometry's padding bands, no PML on the bottom).
  const pml =
    options.pml ??
    defaultMicrostripPml(
      bounds,
      params,
      options.pmlKappaMax ?? 5,
      options.pmlOrder ?? 2,
    );

  // 4. Shift seed: k₀² · ε_eff(KJ-static) for the quasi-TEM mode.
  const kj = hammerstadJensen(params);
  const epsEffSeed = kj.epsilonEff;
  const shift: Complex = options.shift ?? {
    re: k0Squared * epsEffSeed,
    im: 0,
  };

  // 5. Run the PML pipeline.
  const eigsolve = solveMixedSystemPml(mesh, topology, {
    epsilonR: (attr) =>
      attr === RegionAttr.Substrate ? params.epsilonR : 1,
    muR: () => 1,
    pml,
    k0Squared,
    shift,
    isPecMarker: isMicrostripPec,
    ...(options.innerTol !== undefined ? { innerTol: options.innerTol } : {}),
    ...(options.outerTol !== undefined ? { outerTol: options.outerTol } : {}),
    ...(options.outerMaxIter !== undefined
      ? { outerMaxIter: options.outerMaxIter }
      : {}),
    ...(options.innerMaxIter !== undefined
      ? { innerMaxIter: options.innerMaxIter }
      : {}),
  });

  // β = √β² (principal branch).
  const beta = complexSqrtPrincipal(eigsolve.beta2);

  return {
    ...eigsolve,
    k0Squared,
    epsEffSeed,
    beta,
    mesh,
    topology,
  };
}

function complexSqrtPrincipal(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im);
  const re = Math.sqrt((r + z.re) / 2);
  const imSign = z.im >= 0 ? 1 : -1;
  const im = imSign * Math.sqrt((r - z.re) / 2);
  return { re, im };
}

/** Re-export `noPml` so callers running PEC-truncation baselines
 *  don't need to import it from `pml.ts` separately. */
export { noPml };
