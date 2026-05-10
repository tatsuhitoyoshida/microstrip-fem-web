/**
 * Stretched-coordinate PML (SC-PML) profile + weight derivation
 * (Round 8c Stage 3a-iv).
 *
 * Theory in one paragraph: replacing real coordinates with complex
 * stretched ones,
 *
 *     ∂/∂x  →  (1/s_x) · ∂/∂x,    s_x  =  1  −  j σ_x(x)/ω
 *
 * (and analogously for y) makes outgoing plane waves decay
 * exponentially in the PML zone without reflection at the *inner*
 * PML boundary in the continuous limit. After folding the s factors
 * out of the curl operator, the SC-PML wave equation has the same
 * shape as the un-stretched one but with **anisotropic complex**
 * effective material tensors:
 *
 *     1/μ̃_eff,zz       =  1 / (μ_r · s_x · s_y)
 *     ε̃_eff,t (diag)  =  ε_r · diag( s_y/s_x,  s_x/s_y )
 *     1/μ̃_eff,t (diag) =  μ_r⁻¹ · diag( s_y/s_x,  s_x/s_y )
 *
 * — exactly the inputs `complex-vector-assembly.ts` consumes.
 *
 * This module supplies:
 *
 *   1. **1-D profiles**: per-axis stretch factor `s(coord)` as a
 *      function of position. Outside the PML zone `s(coord) = 1`
 *      exactly (so triangles in the interior reproduce the un-PML
 *      isotropic case to FP precision). Inside, `s` ramps smoothly
 *      from 1 at the inner boundary to `1 − jκ_max` at the outer
 *      boundary using a polynomial taper. The polynomial taper is
 *      what gives PML its low theoretical reflection coefficient.
 *
 *   2. **2-D config**: Cartesian product of two 1-D profiles. The
 *      lossy profile can be set on either axis independently — we'll
 *      use both for microstrip (PML on the air side and on the
 *      lateral edges, real coordinates inside the substrate).
 *
 *   3. **Weight factories** that turn a (PML config, μ_r, ε_r)
 *      bundle into the three callbacks the assembly modules expect.
 *
 * Reference for the polynomial taper: J. P. Berenger, *Perfectly
 * Matched Layer (PML) for Computational Electromagnetics* (Morgan &
 * Claypool, 2007), Ch. 2; Taflove & Hagness, *Computational
 * Electrodynamics* (3rd ed.) §7 for SC-PML in particular.
 */

import type { Complex } from './complex-sparse';
import type {
  AnisoWeight,
  ComplexScalarWeight,
} from './complex-vector-assembly';

/**
 * 1-D stretched-coordinate profile. `s(coord)` returns 1 outside the
 * PML region and 1 − jκ inside, with κ ≥ 0 ramping smoothly across
 * the layer.
 */
export interface PmlProfile1D {
  s: (coord: number) => Complex;
  /** Inner edge of the PML layer (towards the physical region).
   *  `s(coord) = 1` for coord between innerLo and innerHi. */
  innerLo: number;
  innerHi: number;
}

/** Identity profile (no PML on this axis). Useful when only one
 *  cartesian direction needs PML. */
export function identityProfile1D(): PmlProfile1D {
  return {
    s: () => ({ re: 1, im: 0 }),
    innerLo: -Infinity,
    innerHi: Infinity,
  };
}

export interface PolynomialPmlOptions {
  /**
   * Inner extent of the physical region — `s(coord) = 1` for
   * `innerLo ≤ coord ≤ innerHi`.
   */
  innerLo: number;
  innerHi: number;
  /** Outer boundary of the PML layer on the low side. `outerLo < innerLo`. */
  outerLo: number;
  /** Outer boundary of the PML layer on the high side. `outerHi > innerHi`. */
  outerHi: number;
  /** Maximum imaginary part `κ_max` reached at the outer boundaries.
   *  Higher values absorb more aggressively but introduce stronger
   *  numerical reflection at the inner PML boundary. Typical values
   *  are O(1) to O(10) in dimensionless units. */
  kappaMax: number;
  /** Polynomial taper order. 2 (quadratic) is the textbook default;
   *  higher orders give a smoother on-ramp at the cost of weaker
   *  absorption near the inner boundary. */
  order?: number;
}

/**
 * Polynomial-taper SC-PML profile:
 *
 *     κ(coord) = κ_max · (d / L)^m,    d = distance into the PML,
 *                                       L = (outer − inner) on that side
 *
 * with `m = order` (default 2). `s(coord) = 1 − jκ(coord)` inside the
 * PML, exactly 1 outside.
 *
 * Tapering smoothly from κ=0 at the inner boundary is what lets PML
 * keep its low theoretical reflection — a step in κ would itself be
 * a discontinuity that scatters the incoming wave.
 */
export function polynomialPmlProfile1D(opts: PolynomialPmlOptions): PmlProfile1D {
  const { innerLo, innerHi, outerLo, outerHi, kappaMax } = opts;
  const order = opts.order ?? 2;
  if (outerLo >= innerLo) {
    throw new Error('polynomialPmlProfile1D: outerLo must be < innerLo');
  }
  if (outerHi <= innerHi) {
    throw new Error('polynomialPmlProfile1D: outerHi must be > innerHi');
  }
  if (kappaMax < 0) {
    throw new Error('polynomialPmlProfile1D: kappaMax must be ≥ 0');
  }
  const Llo = innerLo - outerLo;
  const Lhi = outerHi - innerHi;

  return {
    innerLo,
    innerHi,
    s: (coord: number): Complex => {
      if (coord >= innerLo && coord <= innerHi) {
        return { re: 1, im: 0 };
      }
      let d: number;
      let L: number;
      if (coord < innerLo) {
        d = innerLo - coord;
        L = Llo;
      } else {
        d = coord - innerHi;
        L = Lhi;
      }
      // Clamp `d` to the PML thickness so coords past `outer` saturate
      // at κ_max instead of growing unbounded.
      const t = Math.max(0, Math.min(1, d / L));
      const kappa = kappaMax * Math.pow(t, order);
      return { re: 1, im: -kappa };
    },
  };
}

/** 2-D PML config: independent stretch profiles for each axis. */
export interface Pml2D {
  x: PmlProfile1D;
  y: PmlProfile1D;
}

/** Convenience: no PML at all. The weight factories reduce to plain
 *  isotropic real materials when given this config. */
export function noPml(): Pml2D {
  return { x: identityProfile1D(), y: identityProfile1D() };
}

/** Per-region scalar material parameter (real). For mostly-isotropic
 *  problems with a couple of dielectric regions this is the natural
 *  shape. */
export type RealRegionWeight = (regionAttr: number) => number;

/** Bundle of (PML config, μ_r, ε_r) the weight factories below
 *  consume. Materials are real; the complex content comes entirely
 *  from the PML stretching factors. */
export interface PmlMaterials {
  pml: Pml2D;
  muR: RealRegionWeight;
  epsR: RealRegionWeight;
}

/**
 * Curl-curl scalar weight γ(x, y) = 1 / (μ_r · s_x · s_y).
 *
 * Outside the PML this collapses to 1/μ_r (real); inside it picks up
 * the absorbing imaginary part. Used by `assembleEdgeCurlCurlComplex`.
 */
export function pmlCurlCurlWeight(materials: PmlMaterials): ComplexScalarWeight {
  return (regionAttr, x, y) => {
    const sx = materials.pml.x.s(x);
    const sy = materials.pml.y.s(y);
    // s_x · s_y (complex multiply)
    const prodRe = sx.re * sy.re - sx.im * sy.im;
    const prodIm = sx.re * sy.im + sx.im * sy.re;
    // γ = 1 / (μ_r · prod) = (1/μ_r) · prod̄ / |prod|²
    const muInv = 1 / materials.muR(regionAttr);
    const denom = prodRe * prodRe + prodIm * prodIm;
    return {
      re: (muInv * prodRe) / denom,
      im: (-muInv * prodIm) / denom,
    };
  };
}

/**
 * Mass tensor weight α(x, y) = ε_r · diag(s_y/s_x, s_x/s_y).
 *
 * Diagonal in (x, y) for axis-aligned SC-PML; off-diagonal entries
 * would only appear with rotated PML, which we don't need. Used by
 * `assembleEdgeMassAniso`.
 */
export function pmlMassWeight(materials: PmlMaterials): AnisoWeight {
  return (regionAttr, x, y) => {
    const sx = materials.pml.x.s(x);
    const sy = materials.pml.y.s(y);
    const eps = materials.epsR(regionAttr);
    return {
      xx: cdivScaled(eps, sy, sx),
      yy: cdivScaled(eps, sx, sy),
    };
  };
}

/**
 * Coupling tensor weight (1/μ_r) · diag(s_y/s_x, s_x/s_y).
 *
 * Same diagonal-tensor structure as `pmlMassWeight`; the only
 * difference is the leading scalar factor (μ_r⁻¹ instead of ε_r).
 * Used by `assembleEdgeNodeCouplingAniso`.
 */
export function pmlCouplingWeight(materials: PmlMaterials): AnisoWeight {
  return (regionAttr, x, y) => {
    const sx = materials.pml.x.s(x);
    const sy = materials.pml.y.s(y);
    const muInv = 1 / materials.muR(regionAttr);
    return {
      xx: cdivScaled(muInv, sy, sx),
      yy: cdivScaled(muInv, sx, sy),
    };
  };
}

/** Helper: returns `scalar · (numer / denom)` as a complex number. */
function cdivScaled(scalar: number, numer: Complex, denom: Complex): Complex {
  // (a + jb) / (c + jd) = ((ac + bd) + j(bc - ad)) / (c² + d²)
  const denomMag = denom.re * denom.re + denom.im * denom.im;
  if (denomMag === 0) {
    throw new Error('cdivScaled: division by zero stretch factor');
  }
  const re = (numer.re * denom.re + numer.im * denom.im) / denomMag;
  const im = (numer.im * denom.re - numer.re * denom.im) / denomMag;
  return { re: scalar * re, im: scalar * im };
}
