/**
 * Capacitance extraction via the energy method.
 *
 * From the FEM stored energy
 *
 *   W_e = (1/2) φᵀ K_phys φ      [J/m]
 *
 * the per-unit-length capacitance is
 *
 *   C = 2 W_e / V²              [F/m]
 *
 * Our K is dimensionless (no ε₀ baked in). The physical scaling reintroduces
 * ε₀ — and importantly, K is also scale-invariant in the geometric sense
 * because each element's `area·∇N·∇N` term is dimensionless. The whole 2-D
 * integral therefore has a single overall factor of ε₀, which we apply here.
 *
 * For the unit-drive convention V = 1 V used throughout the rest of the
 * pipeline, C [F/m] = ε₀ · φᵀ K φ.
 */

import { spmv, type CsrMatrix } from './sparse';
import { EPSILON_0 } from './constants';

/** Quadratic form φᵀ K φ — the dimensionless stored "capacitance number". */
export function quadraticForm(K: CsrMatrix, phi: Float64Array): number {
  const Kphi = spmv(K, phi);
  let s = 0;
  for (let i = 0; i < phi.length; i++) s += phi[i]! * Kphi[i]!;
  return s;
}

/**
 * Capacitance per unit length [F/m] for a unit-drive (V = 1 V) solution.
 * Pass the *original* (BC-free) K so the bilinear form represents the true
 * stored energy.
 */
export function capacitancePerLength(K: CsrMatrix, phi: Float64Array): number {
  return EPSILON_0 * quadraticForm(K, phi);
}
