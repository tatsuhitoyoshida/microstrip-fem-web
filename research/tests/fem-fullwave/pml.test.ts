// @vitest-environment node
/**
 * SC-PML profile + weight derivation (Round 8c Stage 3a-iv).
 *
 * Five layers of validation, all independent of any actual eigenvalue
 * solve (those come in Stage 3a-v):
 *
 *   1. **Identity profile collapses to 1** — when no PML is configured
 *      on an axis the stretch factor is exactly real 1, so the
 *      weight factories pass-through to isotropic real materials.
 *
 *   2. **Polynomial profile boundary behaviour** — `s = 1` exactly at
 *      the inner boundary, `s = 1 − jκ_max` exactly at the outer.
 *      No taper means *some* discontinuity at the inner boundary,
 *      which scatters; the polynomial taper is what avoids that.
 *
 *   3. **Polynomial taper monotonicity and saturation** — κ grows
 *      monotonically from 0 at inner to κ_max at outer, then clamps
 *      at κ_max past the outer boundary (so coordinates outside the
 *      PML zone don't blow up).
 *
 *   4. **Weight reduction**: with `noPml()` the curl-curl weight is
 *      real `1/μ_r`, the mass tensor is `diag(ε_r, ε_r)`, the
 *      coupling tensor is `diag(1/μ_r, 1/μ_r)`. Anything else means
 *      the PML factory has a sign or accidental-conjugate bug.
 *
 *   5. **PML zone produces non-zero imaginary parts** in all three
 *      tensors — the actual sanity check that absorption shows up.
 */

import { describe, expect, it } from 'vitest';
import {
  identityProfile1D,
  noPml,
  pmlCouplingWeight,
  pmlCurlCurlWeight,
  pmlMassWeight,
  polynomialPmlProfile1D,
} from '../../src/fem-fullwave/pml';

describe('SC-PML 1-D profiles', () => {
  it('identityProfile1D returns 1 + 0j everywhere', () => {
    const p = identityProfile1D();
    for (const coord of [-100, -1, 0, 1, 100]) {
      const s = p.s(coord);
      expect(s.re).toBe(1);
      expect(s.im).toBe(0);
    }
  });

  it('polynomial profile equals 1 + 0j inside the inner band', () => {
    const p = polynomialPmlProfile1D({
      innerLo: 0,
      innerHi: 1,
      outerLo: -0.3,
      outerHi: 1.3,
      kappaMax: 5,
      order: 2,
    });
    for (const coord of [0, 0.25, 0.5, 0.75, 1]) {
      const s = p.s(coord);
      expect(s.re).toBe(1);
      expect(s.im).toBe(0);
    }
  });

  it('polynomial profile hits 1 − j·kappaMax exactly at the outer boundaries', () => {
    const p = polynomialPmlProfile1D({
      innerLo: 0,
      innerHi: 1,
      outerLo: -0.3,
      outerHi: 1.3,
      kappaMax: 5,
      order: 2,
    });
    const sLo = p.s(-0.3);
    expect(sLo.re).toBe(1);
    expect(sLo.im).toBeCloseTo(-5, 12);
    const sHi = p.s(1.3);
    expect(sHi.re).toBe(1);
    expect(sHi.im).toBeCloseTo(-5, 12);
  });

  it('polynomial taper is monotonically increasing in |Im s| from inner to outer', () => {
    const p = polynomialPmlProfile1D({
      innerLo: 0,
      innerHi: 1,
      outerLo: -0.5,
      outerHi: 1.5,
      kappaMax: 4,
      order: 2,
    });
    // Sample 8 points moving away from the inner boundary on the high side.
    const samples = Array.from({ length: 8 }, (_, k) => 1 + (k + 1) * (0.5 / 9));
    let prev = 0;
    for (const coord of samples) {
      const s = p.s(coord);
      const kappa = -s.im;
      expect(kappa).toBeGreaterThan(prev - 1e-15);
      prev = kappa;
    }
    // Final value should be < kappaMax (= 4) since coord < outer.
    expect(prev).toBeLessThan(4);
  });

  it('polynomial profile saturates past the outer boundary', () => {
    // Coords beyond the outer edge should clamp to s = 1 − j κ_max
    // rather than continue past it.
    const p = polynomialPmlProfile1D({
      innerLo: 0,
      innerHi: 1,
      outerLo: -0.2,
      outerHi: 1.2,
      kappaMax: 3,
      order: 2,
    });
    for (const beyond of [1.2, 1.5, 5, 100]) {
      const s = p.s(beyond);
      expect(s.re).toBe(1);
      expect(s.im).toBeCloseTo(-3, 12);
    }
  });

  it('order=2 quadratic taper matches the closed form at midpoint', () => {
    // At d/L = 0.5, κ = κ_max · 0.25.
    const p = polynomialPmlProfile1D({
      innerLo: 0,
      innerHi: 1,
      outerLo: -1,
      outerHi: 2,
      kappaMax: 8,
      order: 2,
    });
    // High-side midpoint of the PML: coord = 1 + 0.5 · 1 = 1.5.
    const s = p.s(1.5);
    expect(s.im).toBeCloseTo(-8 * 0.25, 12);
  });
});

describe('SC-PML weight factories — reduction to isotropic real', () => {
  const muR = (attr: number) => (attr === 1 ? 1.5 : 1);
  const epsR = (attr: number) => (attr === 1 ? 4 : 1);

  it('noPml() makes the curl-curl weight a real scalar 1/μ_r', () => {
    const w = pmlCurlCurlWeight({ pml: noPml(), muR, epsR });
    const interior = w(0, 0.5, 0.5);
    expect(interior.re).toBeCloseTo(1, 12);
    // Use toBeCloseTo (not toBe) — JavaScript happily produces a
    // signed `-0` from `−inv · 0 / denom` and `expect.toBe(0)` then
    // trips on `Object.is(-0, 0) === false`. Mathematically zero is
    // zero either way.
    expect(interior.im).toBeCloseTo(0, 12);
    const dielectric = w(1, 0.5, 0.5);
    expect(dielectric.re).toBeCloseTo(1 / 1.5, 12);
    expect(dielectric.im).toBeCloseTo(0, 12);
  });

  it('noPml() makes the mass tensor diag(ε_r, ε_r) with zero imag', () => {
    const w = pmlMassWeight({ pml: noPml(), muR, epsR });
    const t = w(1, 0, 0);
    expect(t.xx.re).toBeCloseTo(4, 12);
    expect(t.xx.im).toBe(0);
    expect(t.yy.re).toBeCloseTo(4, 12);
    expect(t.yy.im).toBe(0);
  });

  it('noPml() makes the coupling tensor diag(1/μ_r, 1/μ_r)', () => {
    const w = pmlCouplingWeight({ pml: noPml(), muR, epsR });
    const t = w(1, 0, 0);
    expect(t.xx.re).toBeCloseTo(1 / 1.5, 12);
    expect(t.xx.im).toBe(0);
    expect(t.yy.re).toBeCloseTo(1 / 1.5, 12);
    expect(t.yy.im).toBe(0);
  });
});

describe('SC-PML weight factories — absorption inside the layer', () => {
  // PML on x only, layer on the high side from x = 1 to x = 1.4.
  const profile = polynomialPmlProfile1D({
    innerLo: 0,
    innerHi: 1,
    outerLo: -0.4,
    outerHi: 1.4,
    kappaMax: 2,
    order: 2,
  });
  const pml = { x: profile, y: identityProfile1D() };
  const muR = () => 1;
  const epsR = () => 1;
  const materials = { pml, muR, epsR };

  it('curl-curl weight picks up imaginary part inside the PML', () => {
    const w = pmlCurlCurlWeight(materials);
    // Inside the layer, halfway through (x = 1.2 → t = 0.5 → κ = 0.5).
    const inside = w(0, 1.2, 0.5);
    // s_x = 1 − 0.5j, s_y = 1, product = 1 − 0.5j → 1/product = (1 + 0.5j) / 1.25
    expect(inside.re).toBeCloseTo(1 / 1.25, 9);
    expect(inside.im).toBeCloseTo(0.5 / 1.25, 9);
  });

  it('mass tensor has different xx and yy when only x is PML-stretched', () => {
    const w = pmlMassWeight(materials);
    const t = w(0, 1.2, 0.5);
    // ε_r = 1, s_x = 1 − 0.5j, s_y = 1.
    // αxx = ε · s_y / s_x = 1 / (1 − 0.5j) = (1 + 0.5j) / 1.25
    expect(t.xx.re).toBeCloseTo(1 / 1.25, 9);
    expect(t.xx.im).toBeCloseTo(0.5 / 1.25, 9);
    // αyy = ε · s_x / s_y = 1 − 0.5j
    expect(t.yy.re).toBeCloseTo(1, 9);
    expect(t.yy.im).toBeCloseTo(-0.5, 9);
  });

  it('coupling tensor agrees with mass tensor up to the leading scalar', () => {
    // For μ_r = ε_r = 1 the coupling tensor and mass tensor are
    // identical — both reduce to diag(s_y/s_x, s_x/s_y).
    const wm = pmlMassWeight(materials);
    const wc = pmlCouplingWeight(materials);
    const m = wm(0, 1.2, 0.5);
    const c = wc(0, 1.2, 0.5);
    expect(c.xx.re).toBeCloseTo(m.xx.re, 12);
    expect(c.xx.im).toBeCloseTo(m.xx.im, 12);
    expect(c.yy.re).toBeCloseTo(m.yy.re, 12);
    expect(c.yy.im).toBeCloseTo(m.yy.im, 12);
  });
});
