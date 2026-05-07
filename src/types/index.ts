/**
 * Geometric and material parameters of a single-ended microstrip line.
 * All length quantities must share the same unit (e.g. all in mm or all in m);
 * Z₀ is scale-invariant under uniform rescaling.
 */
export interface MicrostripParams {
  /** Trace (signal conductor) width */
  width: number;
  /** Substrate thickness (height between trace and ground) */
  height: number;
  /** Conductor thickness (set to 0 for ideal zero-thickness conductor) */
  thickness: number;
  /** Relative permittivity of the substrate dielectric */
  epsilonR: number;
}

/**
 * Result of a microstrip Z₀ / ε_eff calculation.
 */
export interface MicrostripResult {
  /** Characteristic impedance Z₀ [Ω] */
  z0: number;
  /** Effective relative permittivity ε_eff [-] */
  epsilonEff: number;
}
