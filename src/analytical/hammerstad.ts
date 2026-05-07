/**
 * Hammerstad–Jensen (1980) closed-form expressions for microstrip
 * characteristic impedance Z₀ and effective relative permittivity ε_eff.
 *
 * Reference: E. Hammerstad and Ø. Jensen, "Accurate Models for Microstrip
 * Computer-Aided Design," IEEE MTT-S Int. Microwave Symp. Dig., 1980,
 * pp. 407–409. The original authors quote ~0.01% accuracy for ε_eff and
 * ~0.03% for Z₀ across 0.01 ≤ u ≤ 100 and ε_r ≤ 128 (no losses, no thickness).
 *
 * Conductor thickness t is folded in via the standard Wheeler/Bahl effective-
 * width correction (Bahl & Trivedi, 1977), applied here as a single ΔW added
 * to W before evaluating the zero-thickness formula.
 */

import { ETA_0 } from '../fem/constants';
import type { MicrostripParams, MicrostripResult } from '../types';

/**
 * Effective trace width accounting for finite conductor thickness t.
 * For W/h ≥ 1/(2π):  ΔW = (t/π) · (1 + ln(2h/t))
 * For W/h < 1/(2π):  ΔW = (t/π) · (1 + ln(4πW/t))
 */
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
 * ε_eff per Hammerstad–Jensen.
 *   a(u) = 1 + (1/49) ln((u^4 + (u/52)^2)/(u^4 + 0.432)) + (1/18.7) ln(1 + (u/18.1)^3)
 *   b(εr) = 0.564 · ((εr − 0.9)/(εr + 3))^0.053
 *   ε_eff = (εr+1)/2 + (εr−1)/2 · (1 + 10/u)^(−a·b)
 */
function epsilonEffHJ(u: number, epsilonR: number): number {
  const u4 = u * u * u * u;
  const a =
    1 + Math.log((u4 + (u / 52) ** 2) / (u4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7;
  const b = 0.564 * ((epsilonR - 0.9) / (epsilonR + 3)) ** 0.053;
  return (epsilonR + 1) / 2 + ((epsilonR - 1) / 2) * (1 + 10 / u) ** (-a * b);
}

/**
 * Vacuum (εr = 1) Z₀ per Hammerstad–Jensen.
 *   f(u) = 6 + (2π − 6) · exp(−(30.666/u)^0.7528)
 *   Z₀₁  = (η₀/2π) · ln(f(u)/u + √(1 + (2/u)²))
 */
function z0VacuumHJ(u: number): number {
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** 0.7528));
  return (ETA_0 / (2 * Math.PI)) * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2));
}

/**
 * Compute Z₀ and ε_eff for a microstrip using the Hammerstad–Jensen formulas.
 * Quasi-static, lossless. Conductor thickness is handled via the effective
 * width correction.
 */
export function hammerstadJensen(params: MicrostripParams): MicrostripResult {
  const { width, height, thickness, epsilonR } = params;
  if (width <= 0 || height <= 0 || epsilonR < 1) {
    throw new Error('hammerstadJensen: width and height must be > 0 and εr ≥ 1');
  }

  const wEff = effectiveWidth(width, height, thickness);
  const u = wEff / height;
  const epsilonEff = epsilonEffHJ(u, epsilonR);
  const z0 = z0VacuumHJ(u) / Math.sqrt(epsilonEff);
  return { z0, epsilonEff };
}
