/**
 * Frequency-dispersion correction for microstrip ε_eff and Z₀.
 *
 * Reference (ε_eff dispersion):
 *   M. Kirschning, R. H. Jansen, "Accurate model for effective dielectric
 *   constant of microstrip with validity up to millimetre-wave frequencies,"
 *   Electron. Lett., vol. 18, no. 6, pp. 272–273, Mar. 1982.
 *
 * The model takes a quasi-static ε_eff (computed by any rigorous static
 * solver — in our case the in-browser 2D FEM) and stretches it toward the
 * substrate's bulk ε_r as frequency rises:
 *
 *     ε_eff(f) = ε_r − (ε_r − ε_eff_qs) / (1 + P(f, geometry))
 *
 * The dimensionless P(·) is built from four geometry/εr coefficients
 * P1..P4 plus a frequency-thickness term. With f in GHz and h in mm the
 * model is reported accurate to better than 0.6 % for ε_r ≤ 20 and W/h up
 * to 100, well past the millimetre-wave band (~60 GHz on standard PCB).
 *
 * Z₀(f) is then estimated from the ε_eff ratio:
 *
 *     Z₀(f) ≈ Z₀_qs · √(ε_eff_qs / ε_eff(f))
 *
 * This is the leading-order term — the full Kirschning-Jansen Z₀(f) model
 * uses an auxiliary Z_T (open-stripline limit) that adds a few extra
 * percent of accuracy at the very top of the band; we deliberately stick
 * to the simpler form because the underlying static solve is already
 * rigorous (FEM, not a closed-form approximation), so the correction
 * only needs to capture the dominant frequency dependence.
 *
 * v0.1 application: invoked as a post-process inside ResultsPanel after
 * the FEM solve. The FEM pipeline itself stays purely quasi-static.
 */

export interface DispersionInput {
  /** Bulk relative permittivity εr of the substrate. */
  epsilonR: number;
  /** Quasi-static effective permittivity from the FEM solve. */
  epsilonEffStatic: number;
  /** Trace width W in millimetres. */
  widthMm: number;
  /** Substrate height h in millimetres. */
  heightMm: number;
  /** Operating frequency f in GHz. */
  frequencyGHz: number;
}

export interface DispersionOutput {
  /** Frequency-dependent effective permittivity ε_eff(f). */
  epsilonEffF: number;
  /** Multiplicative correction factor for Z₀: Z₀(f) = Z₀_qs · z0Ratio. */
  z0Ratio: number;
}

/**
 * Apply the Kirschning–Jansen ε_eff(f) correction and derive the matching
 * Z₀(f) ratio.
 *
 * For f → 0 the function reduces exactly to the identity (`epsilonEffF`
 * equals the static input, `z0Ratio` equals 1) so callers don't need to
 * special-case "DC". Negative or non-finite frequencies clamp to 0.
 */
export function dispersionCorrection(input: DispersionInput): DispersionOutput {
  const { epsilonR, epsilonEffStatic, widthMm, heightMm, frequencyGHz } = input;
  const f = Number.isFinite(frequencyGHz) && frequencyGHz > 0 ? frequencyGHz : 0;
  if (f === 0 || heightMm <= 0 || widthMm <= 0) {
    return { epsilonEffF: epsilonEffStatic, z0Ratio: 1 };
  }

  const u = widthMm / heightMm;
  // K-J coefficients are stated for f in GHz and h in mm. The combiner has
  // no explicit unit factor (some references show "10·f·h_cm" but that is
  // numerically identical to "f·h_mm" — we use the mm form here for
  // clarity and to match published evaluations).
  const fh = f * heightMm; // [GHz · mm]

  // P1..P4 coefficients per Kirschning–Jansen 1982/1996.
  const P1 =
    0.27488 +
    (0.6315 + 0.525 / Math.pow(1 + 0.0157 * fh, 20)) * u -
    0.065683 * Math.exp(-8.7513 * u);
  const P2 = 0.33622 * (1 - Math.exp(-0.03442 * epsilonR));
  const P3 = 0.0363 * Math.exp(-4.6 * u) * (1 - Math.exp(-Math.pow(fh / 3.87, 4.97)));
  const P4 = 1 + 2.751 * (1 - Math.exp(-Math.pow(epsilonR / 15.916, 8)));

  const P = P1 * P2 * Math.pow((0.1844 + P3 * P4) * fh, 1.5763);

  const epsilonEffF = epsilonR - (epsilonR - epsilonEffStatic) / (1 + P);
  // Guard: ε_eff should always satisfy ε_eff_qs ≤ ε_eff(f) ≤ εr. If geometry
  // is degenerate enough that the formula leaves the band (numerical edge),
  // clip back to static so the result stays physical.
  const epsilonEffSafe = Math.max(epsilonEffStatic, Math.min(epsilonR, epsilonEffF));
  const z0Ratio = Math.sqrt(epsilonEffStatic / epsilonEffSafe);
  return { epsilonEffF: epsilonEffSafe, z0Ratio };
}
