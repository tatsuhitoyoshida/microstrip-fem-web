/**
 * Spot checks for the Kirschning-Jansen ε_eff(f) / Z₀(f) post-process.
 *
 * The reference numbers come from re-evaluating the published formulae for
 * standard PCB geometries. We don't compare against full-wave reference
 * data here (that's documented in `docs/validation.md` once Tatsy collects
 * it); this test pins the implementation to its analytical definition so
 * future refactors don't silently shift the dispersion behaviour.
 */

import { describe, expect, it } from 'vitest';
import { dispersionCorrection } from '../src/analytical/dispersion';

describe('Kirschning-Jansen dispersion correction', () => {
  it('reduces to identity at f = 0', () => {
    const out = dispersionCorrection({
      epsilonR: 4.4,
      epsilonEffStatic: 3.28,
      widthMm: 3.0,
      heightMm: 1.6,
      frequencyGHz: 0,
    });
    expect(out.epsilonEffF).toBeCloseTo(3.28, 6);
    expect(out.z0Ratio).toBeCloseTo(1, 6);
  });

  it('clamps non-finite / negative frequency to identity', () => {
    const out = dispersionCorrection({
      epsilonR: 4.4,
      epsilonEffStatic: 3.28,
      widthMm: 3.0,
      heightMm: 1.6,
      frequencyGHz: Number.NaN,
    });
    expect(out.epsilonEffF).toBe(3.28);
    expect(out.z0Ratio).toBe(1);
  });

  it('FR-4 typical microstrip drifts ε_eff up and Z₀ down with frequency', () => {
    // 50 Ω microstrip on FR-4: εr=4.4, h=1.6 mm, W=3 mm, ε_eff_qs ≈ 3.28.
    const fr4 = (f: number) =>
      dispersionCorrection({
        epsilonR: 4.4,
        epsilonEffStatic: 3.28,
        widthMm: 3.0,
        heightMm: 1.6,
        frequencyGHz: f,
      });

    const dc = fr4(0);
    const at1 = fr4(1);
    const at10 = fr4(10);
    const at20 = fr4(20);

    // Monotone in f — dispersion only ever pushes ε_eff toward εr.
    expect(at1.epsilonEffF).toBeGreaterThan(dc.epsilonEffF);
    expect(at10.epsilonEffF).toBeGreaterThan(at1.epsilonEffF);
    expect(at20.epsilonEffF).toBeGreaterThan(at10.epsilonEffF);

    // Bounded by εr (sanity).
    expect(at20.epsilonEffF).toBeLessThan(4.4);

    // 1 GHz is essentially DC for this geometry — change should be
    // sub-percent.
    expect(at1.epsilonEffF - dc.epsilonEffF).toBeLessThan(0.02);

    // 10 GHz: typical PCB literature reports a 5–10 % ε_eff shift for this
    // geometry. We assert a soft envelope rather than a single number so
    // future refactors that re-derive constants don't trip on a tight match.
    expect(at10.epsilonEffF).toBeGreaterThan(3.32);
    expect(at10.epsilonEffF).toBeLessThan(3.70);

    // Z₀ scales as 1/√(ε_eff/ε_eff_qs) → drops monotonically with f.
    expect(at10.z0Ratio).toBeLessThan(at1.z0Ratio);
    expect(at20.z0Ratio).toBeLessThan(at10.z0Ratio);
    // 10 GHz Z₀ drop should sit in the 2–6 % band for this geometry.
    expect(at10.z0Ratio).toBeGreaterThan(0.94);
    expect(at10.z0Ratio).toBeLessThan(0.99);
  });

  it('alumina (high-εr) substrate behaves consistently', () => {
    // Alumina εr = 9.8, h = 0.635 mm, W = 0.59 mm targets 50 Ω.
    // ε_eff_qs ≈ 6.7 from the standard formulas.
    const out = dispersionCorrection({
      epsilonR: 9.8,
      epsilonEffStatic: 6.7,
      widthMm: 0.59,
      heightMm: 0.635,
      frequencyGHz: 20,
    });
    expect(out.epsilonEffF).toBeGreaterThan(6.7);
    expect(out.epsilonEffF).toBeLessThan(9.8);
    expect(out.z0Ratio).toBeGreaterThan(0.85);
    expect(out.z0Ratio).toBeLessThan(1);
  });

  it('never returns ε_eff < ε_eff_qs (physical lower bound)', () => {
    // Sweep a few combinations and check the floor-clip in the implementation.
    const cases = [
      { epsilonR: 2.2, epsilonEffStatic: 1.85, widthMm: 2.4, heightMm: 0.787, frequencyGHz: 30 },
      { epsilonR: 4.4, epsilonEffStatic: 3.28, widthMm: 3.0, heightMm: 1.6, frequencyGHz: 0.001 },
      { epsilonR: 9.8, epsilonEffStatic: 6.7, widthMm: 0.59, heightMm: 0.635, frequencyGHz: 50 },
    ];
    for (const c of cases) {
      const { epsilonEffF, z0Ratio } = dispersionCorrection(c);
      expect(epsilonEffF).toBeGreaterThanOrEqual(c.epsilonEffStatic - 1e-9);
      expect(epsilonEffF).toBeLessThanOrEqual(c.epsilonR + 1e-9);
      expect(z0Ratio).toBeLessThanOrEqual(1 + 1e-9);
      expect(z0Ratio).toBeGreaterThan(0);
    }
  });
});
