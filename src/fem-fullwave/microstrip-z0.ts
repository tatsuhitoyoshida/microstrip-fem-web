/**
 * Z₀ extraction from a microstrip PML eigenpair (Round 8c Stage 3a-vi-c).
 *
 * Three quantities, all derived from the converged (β², E_t, E_z):
 *
 *   ε_eff(f) = β² / k₀²          — effective dielectric constant
 *   P        = ½ Re ∫ E × H* · ẑ dA — cross-section power flux
 *   V        = ∫_ground^trace E_y dy at x = 0 — voltage from ground to trace
 *   Z₀       = |V|² / (2 P)        — Voltage-Power characteristic impedance
 *
 * The V-P pairing (rather than V-I or P-I) is convenient for FEM
 * because:
 *   - V is a single 1-D line integral, evaluated by sampling E_y on
 *     a vertical path under the trace centre.
 *   - P uses the same cross-section integral that's natural for
 *     the eigenvector representation.
 * Both give the same answer in the TEM limit (Z₀ = η · h / W for
 * ideal parallel plates), and converge to the static-FEM Z₀ at
 * f → 0.
 *
 * H is recovered from Maxwell with `exp(−jβz)` propagation,
 *     H_t  =  (β / ωμ) (ẑ × E_t)  +  (j / ωμ) (∇_t E_z × ẑ),
 * for the power integral. (Lossless, isotropic μ — fine for
 * non-PML triangles, which is where the integrals are evaluated.)
 *
 * For the quasi-TEM mode this gives the same answer as the static
 * energy-method Z₀ to leading order, with a small frequency-
 * dependent correction matching the KJ formula.
 */

import type { Mesh } from '../types';
import { Marker, RegionAttr } from '../types';
import { triangleGeom } from './nedelec';
import type { EdgeTopology } from './edge-dofs';
import type { Complex } from './complex-sparse';
import type { DirichletPartition } from './boundary';

/** μ₀ in H/mm (= H/m × 1/1000). */
const MU_0 = 4 * Math.PI * 1e-7 * 1e-3;

export interface Z0ExtractOptions {
  /** Edge-DoF eigenvector on free edges (interleaved complex). */
  eFreeEdges: Float64Array;
  /** Node-DoF E_z eigenvector on free nodes (interleaved complex). */
  eFreeNodes: Float64Array;
  /** Free-DoF partitions (used to scatter back to full DoF space for
   *  per-triangle field evaluation). */
  edgePartition: DirichletPartition;
  nodePartition: DirichletPartition;
  /** Recovered β² (complex, from the eigsolver). */
  beta2: Complex;
  /** Operating k₀² in matching length units. */
  k0Squared: number;
  /** Frequency [GHz] — for ωμ in the H formula. */
  frequencyGHz: number;
  /** Trace width W [mm] (for the conductor-loop integration path). */
  traceWidth: number;
  /** Substrate height h [mm]. */
  substrateHeight: number;
  /** Conductor thickness t [mm]. Conductor sits at y ∈ [h, h+t]. */
  conductorThickness: number;
}

export interface Z0ExtractResult {
  /** ε_eff(f) = β²/k₀² (complex; im part = effective loss/gain). */
  epsilonEff: Complex;
  /** β = √β² principal branch. */
  beta: Complex;
  /** Power flux P = ½ Re ∫ E × H* · ẑ dA over the cross-section. */
  power: number;
  /** Voltage V = ∫_ground^trace E_y dy at x = 0 (complex magnitude). */
  voltageMagnitude: number;
  /** Z₀ = |V|² / (2 P). */
  z0: number;
}

interface FullDoFs {
  full: Float64Array; // length 2 * fullSize
}

/** Scatter a free-DoF interleaved complex vector back to full-DoF space. */
function scatterFreeComplex(
  freeVec: Float64Array,
  partition: DirichletPartition,
): FullDoFs {
  const fullSize = partition.freeOf.length;
  const out = new Float64Array(2 * fullSize);
  const nFree = partition.freeIndices.length;
  for (let j = 0; j < nFree; j++) {
    const fullIdx = partition.freeIndices[j]!;
    out[2 * fullIdx] = freeVec[2 * j]!;
    out[2 * fullIdx + 1] = freeVec[2 * j + 1]!;
  }
  return { full: out };
}

/** Principal complex sqrt — branch with non-negative real part. */
function csqrt(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im);
  const re = Math.sqrt((r + z.re) / 2);
  const imSign = z.im >= 0 ? 1 : -1;
  const im = imSign * Math.sqrt((r - z.re) / 2);
  return { re, im };
}

/**
 * Evaluate (E_x, E_y, E_z, ∂E_z/∂x, ∂E_z/∂y) at the centroid of
 * triangle `t`, using the full-DoF eigenvector.
 *
 * Whitney 1-form basis at centroid: each barycentric λ_i evaluates to
 * 1/3, and ∇λ_i = (bs[i], cs[i]) is constant. The basis function for
 * local edge k (opposite vertex k, going (k+1) → (k+2)) is
 * `N_k = λ_a ∇λ_b − λ_b ∇λ_a`, which at the centroid is
 * `N_k = (1/3)(∇λ_b − ∇λ_a)`.
 */
function evalFieldAtCentroid(
  mesh: Mesh,
  topology: EdgeTopology,
  t: number,
  eEdgeFull: Float64Array,
  eNodeFull: Float64Array,
): {
  Ex: Complex;
  Ey: Complex;
  Ez: Complex;
  dEzDx: Complex;
  dEzDy: Complex;
} {
  const v0 = mesh.triangles[3 * t]!;
  const v1 = mesh.triangles[3 * t + 1]!;
  const v2 = mesh.triangles[3 * t + 2]!;
  const x0 = mesh.vertices[2 * v0]!;
  const y0 = mesh.vertices[2 * v0 + 1]!;
  const x1 = mesh.vertices[2 * v1]!;
  const y1 = mesh.vertices[2 * v1 + 1]!;
  const x2 = mesh.vertices[2 * v2]!;
  const y2 = mesh.vertices[2 * v2 + 1]!;
  const geom = triangleGeom(x0, y0, x1, y1, x2, y2);

  let exRe = 0;
  let exIm = 0;
  let eyRe = 0;
  let eyIm = 0;
  for (let k = 0; k < 3; k++) {
    const eIdx = topology.tri2edge[3 * t + k]!;
    const sign = topology.tri2edgeSign[3 * t + k]!;
    const dofRe = eEdgeFull[2 * eIdx]! * sign;
    const dofIm = eEdgeFull[2 * eIdx + 1]! * sign;
    // N_k at centroid = (1/3)(∇λ_b − ∇λ_a), with (a,b) = (k+1, k+2) mod 3.
    const a = (k + 1) % 3;
    const b = (k + 2) % 3;
    const nx = (geom.bs[b]! - geom.bs[a]!) / 3;
    const ny = (geom.cs[b]! - geom.cs[a]!) / 3;
    exRe += dofRe * nx;
    exIm += dofIm * nx;
    eyRe += dofRe * ny;
    eyIm += dofIm * ny;
  }

  // E_z at centroid = (1/3)(v_n0 + v_n1 + v_n2), nodal field.
  let ezRe = 0;
  let ezIm = 0;
  let dEzDxRe = 0;
  let dEzDxIm = 0;
  let dEzDyRe = 0;
  let dEzDyIm = 0;
  const verts: [number, number, number] = [v0, v1, v2];
  for (let i = 0; i < 3; i++) {
    const vIdx = verts[i]!;
    const dofRe = eNodeFull[2 * vIdx]!;
    const dofIm = eNodeFull[2 * vIdx + 1]!;
    ezRe += dofRe / 3;
    ezIm += dofIm / 3;
    dEzDxRe += dofRe * geom.bs[i]!;
    dEzDxIm += dofIm * geom.bs[i]!;
    dEzDyRe += dofRe * geom.cs[i]!;
    dEzDyIm += dofIm * geom.cs[i]!;
  }

  return {
    Ex: { re: exRe, im: exIm },
    Ey: { re: eyRe, im: eyIm },
    Ez: { re: ezRe, im: ezIm },
    dEzDx: { re: dEzDxRe, im: dEzDxIm },
    dEzDy: { re: dEzDyRe, im: dEzDyIm },
  };
}

/**
 * Power-Current Z₀ from the converged eigenpair.
 *
 * P = ½ Re ∫ (E × H*)_z dA, summing only over **non-PML, non-conductor**
 * triangles. (Restricting the integration domain to the physical
 * region keeps the result independent of PML thickness; including PML
 * triangles would double-count their absorbed power and corrupt P.)
 *
 * V is the line integral of E_y from ground (y = 0) to trace
 * (y = h) at x = 0. With 1-point quadrature at the slab midpoint
 * (y = h/2) this is just `E_y(0, h/2) · h`, exact for uniform
 * E_y (TEM limit) and a good approximation for quasi-TEM. Better
 * accuracy uses multi-point Gauss quadrature along the path; punted
 * to a later stage.
 */
export function extractMicrostripZ0(
  mesh: Mesh,
  topology: EdgeTopology,
  options: Z0ExtractOptions,
): Z0ExtractResult {
  const epsEff: Complex = {
    re: options.beta2.re / options.k0Squared,
    im: options.beta2.im / options.k0Squared,
  };
  const beta = csqrt(options.beta2);

  const eEdgeFull = scatterFreeComplex(options.eFreeEdges, options.edgePartition).full;
  const eNodeFull = scatterFreeComplex(options.eFreeNodes, options.nodePartition).full;

  const omega = 2 * Math.PI * options.frequencyGHz * 1e9;
  const omegaMu = omega * MU_0; // ωμ₀ for μ_r = 1 vacuum.
  // β / (ωμ) and 1/(ωμ) are the two coefficients in H_t = (β/ωμ)(ẑ × E_t)
  // + (j/ωμ)(∇E_z × ẑ).
  const betaOverOmegaMu = beta.re / omegaMu;
  // Note: for complex β we'd carry both halves; keeping it real here
  // assumes Im(β) ≪ Re(β), which holds for quasi-TEM bound modes.
  const oneOverOmegaMu = 1 / omegaMu;

  let powerSum = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const x0 = mesh.vertices[2 * v0]!;
    const y0 = mesh.vertices[2 * v0 + 1]!;
    const x1 = mesh.vertices[2 * v1]!;
    const y1 = mesh.vertices[2 * v1 + 1]!;
    const x2 = mesh.vertices[2 * v2]!;
    const y2 = mesh.vertices[2 * v2 + 1]!;
    const cy = (y0 + y1 + y2) / 3;
    const cx = (x0 + x1 + x2) / 3;
    // Skip triangles inside the PML zone — their Re(power) is the
    // amount being absorbed, not propagated.
    const xInner = options.traceWidth / 2 + 5 * options.substrateHeight;
    const yInner =
      options.substrateHeight + options.conductorThickness +
      5 * options.substrateHeight;
    if (Math.abs(cx) > xInner) continue;
    if (cy > yInner) continue;

    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);
    const fields = evalFieldAtCentroid(mesh, topology, t, eEdgeFull, eNodeFull);

    // |E_t|² = |E_x|² + |E_y|²
    const eMag2 =
      fields.Ex.re * fields.Ex.re +
      fields.Ex.im * fields.Ex.im +
      fields.Ey.re * fields.Ey.re +
      fields.Ey.im * fields.Ey.im;
    // E_t · ∇E_z* — only the imag part contributes to the
    // real(E × H*) we're integrating. dotRe (the real part) drops out.
    const dotIm =
      fields.Ex.im * fields.dEzDx.re -
      fields.Ex.re * fields.dEzDx.im +
      fields.Ey.im * fields.dEzDy.re -
      fields.Ey.re * fields.dEzDy.im;
    // (E × H*)_z = (β/ωμ) |E_t|² + (j/ωμ) (E_t · ∇E_z*)
    // Re part = (β/ωμ) |E_t|² + (1/ωμ) (− Im(E_t · ∇E_z*))
    const reExHzAtCentroid =
      betaOverOmegaMu * eMag2 - oneOverOmegaMu * dotIm;
    powerSum += 0.5 * reExHzAtCentroid * geom.area;
  }

  // Voltage V = ∫_0^h E_y dy at x = 0. 1-point quadrature at the
  // slab midpoint (y = h/2) is exact for uniform E_y and a good
  // approximation for quasi-TEM where E_y varies modestly across
  // the substrate.
  const yMid = options.substrateHeight / 2;
  const eyAtMid = evaluateEyAtPoint(mesh, topology, eEdgeFull, 0, yMid);
  const V: Complex = {
    re: eyAtMid.re * options.substrateHeight,
    im: eyAtMid.im * options.substrateHeight,
  };
  const voltageMagnitude = Math.hypot(V.re, V.im);

  // Z₀ = |V|²/(2P)
  const z0 =
    Math.abs(powerSum) > 1e-30
      ? (voltageMagnitude * voltageMagnitude) / (2 * Math.abs(powerSum))
      : 0;

  return {
    epsilonEff: epsEff,
    beta,
    power: powerSum,
    voltageMagnitude,
    z0,
  };
}

/** Locate the triangle containing the point (px, py) and evaluate E_y
 *  there from the edge-DoF eigenvector. Returns (0, 0) if the point
 *  is outside every triangle. Brute-force O(numTri) search — fine
 *  for the few-call usage of Z₀ extraction. */
function evaluateEyAtPoint(
  mesh: Mesh,
  topology: EdgeTopology,
  eEdgeFull: Float64Array,
  px: number,
  py: number,
): Complex {
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = mesh.triangles[3 * t]!;
    const v1 = mesh.triangles[3 * t + 1]!;
    const v2 = mesh.triangles[3 * t + 2]!;
    const x0 = mesh.vertices[2 * v0]!;
    const y0 = mesh.vertices[2 * v0 + 1]!;
    const x1 = mesh.vertices[2 * v1]!;
    const y1 = mesh.vertices[2 * v1 + 1]!;
    const x2 = mesh.vertices[2 * v2]!;
    const y2 = mesh.vertices[2 * v2 + 1]!;
    // Barycentric coordinates of (px, py) in triangle (v0, v1, v2).
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (denom === 0) continue;
    const lam0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
    const lam1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
    const lam2 = 1 - lam0 - lam1;
    const tol = 1e-10;
    if (lam0 < -tol || lam1 < -tol || lam2 < -tol) continue;
    // Inside this triangle. Evaluate E_y from Whitney 1-form basis.
    const geom = triangleGeom(x0, y0, x1, y1, x2, y2);
    const lams: [number, number, number] = [lam0, lam1, lam2];
    let eyRe = 0;
    let eyIm = 0;
    for (let k = 0; k < 3; k++) {
      const eIdx = topology.tri2edge[3 * t + k]!;
      const sign = topology.tri2edgeSign[3 * t + k]!;
      const dofRe = eEdgeFull[2 * eIdx]! * sign;
      const dofIm = eEdgeFull[2 * eIdx + 1]! * sign;
      // N_k = λ_a ∇λ_b − λ_b ∇λ_a with (a, b) = (k+1, k+2) mod 3
      const a = (k + 1) % 3;
      const b = (k + 2) % 3;
      const ny = lams[a]! * geom.cs[b]! - lams[b]! * geom.cs[a]!;
      eyRe += dofRe * ny;
      eyIm += dofIm * ny;
    }
    return { re: eyRe, im: eyIm };
  }
  return { re: 0, im: 0 };
}

/** Re-export used internal markers / region attributes for caller
 *  convenience. */
export { Marker, RegionAttr };
