/**
 * Physical constants used across FEM and analytical modules.
 * Values are SI base units unless otherwise noted.
 */

// Speed of light in vacuum [m/s]
export const SPEED_OF_LIGHT = 299_792_458;

// Vacuum permeability [H/m]
export const MU_0 = 4 * Math.PI * 1e-7;

// Vacuum permittivity [F/m]
export const EPSILON_0 = 1 / (MU_0 * SPEED_OF_LIGHT * SPEED_OF_LIGHT);

// Free-space (intrinsic) impedance [Ω], η₀ = √(μ₀/ε₀) ≈ 376.730 Ω
export const ETA_0 = Math.sqrt(MU_0 / EPSILON_0);
