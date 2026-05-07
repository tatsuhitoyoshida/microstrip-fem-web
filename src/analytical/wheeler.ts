/**
 * Wheeler / "classic Pozar" closed-form expressions for microstrip
 * characteristic impedance Z₀ and effective relative permittivity ε_eff.
 *
 * Reference: H. A. Wheeler, "Transmission-line properties of a strip on a
 * dielectric sheet on a plane," IEEE Trans. MTT, vol. 25, no. 8, 1977.
 * The form below is the simplified two-regime version popularised by
 * Pozar, "Microwave Engineering" (4th ed., §3.8).
 *
 * Quoted accuracy is around 1% for ε_eff and a few % for Z₀; less precise
 * than Hammerstad–Jensen but historically the standard reference and
 * useful as a sanity check / cross-validation target.
 *
 * Conductor thickness t is folded in via the same Wheeler/Bahl effective-
 * width correction used in `hammerstad.ts`.
 */

import type { MicrostripParams, MicrostripResult } from '../types';

function effectiveWidth(width: number, height: number, thickness: number): number {
  if (thickness <= 0) return width;
  const u = width / height;
  const log =
    u >= 1 / (2 * Math.PI)
      ? Math.log((2 * height) / thickness)
      : Math.log((4 * Math.PI * width) / thickness);
  return width + (thickness / Math.PI) * (1 + log);
}

/**
 * ε_eff (Wheeler / Pozar form).
 * Narrow strip (W/h ≤ 1) carries an extra (1 − W/h)² correction term.
 *   ε_eff = (εr+1)/2 + (εr−1)/2 · [ (1 + 12 h/W)^(−1/2)  + 0.04 (1 − W/h)² ]   if u ≤ 1
 *   ε_eff = (εr+1)/2 + (εr−1)/2 · (1 + 12 h/W)^(−1/2)                          if u > 1
 */
function epsilonEffWheeler(u: number, epsilonR: number): number {
  const base = (1 + 12 / u) ** -0.5;
  const correction = u <= 1 ? 0.04 * (1 - u) ** 2 : 0;
  return (epsilonR + 1) / 2 + ((epsilonR - 1) / 2) * (base + correction);
}

/**
 * Z₀ (Wheeler / Pozar form), two regimes split at W/h = 1.
 *   u ≤ 1: Z₀ = (60/√ε_eff) · ln(8/u + u/4)
 *   u > 1: Z₀ = 120π / [√ε_eff · (u + 1.393 + 0.667 · ln(u + 1.444))]
 */
function z0Wheeler(u: number, epsilonEff: number): number {
  const sqrtE = Math.sqrt(epsilonEff);
  if (u <= 1) {
    return (60 / sqrtE) * Math.log(8 / u + u / 4);
  }
  return (120 * Math.PI) / (sqrtE * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
}

/**
 * Compute Z₀ and ε_eff using the Wheeler closed-form (Pozar formulation).
 * Quasi-static, lossless. Conductor thickness handled via effective width.
 */
export function wheeler(params: MicrostripParams): MicrostripResult {
  const { width, height, thickness, epsilonR } = params;
  if (width <= 0 || height <= 0 || epsilonR < 1) {
    throw new Error('wheeler: width and height must be > 0 and εr ≥ 1');
  }

  const wEff = effectiveWidth(width, height, thickness);
  const u = wEff / height;
  const epsilonEff = epsilonEffWheeler(u, epsilonR);
  const z0 = z0Wheeler(u, epsilonEff);
  return { z0, epsilonEff };
}
