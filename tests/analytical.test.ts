import { describe, expect, it } from 'vitest';
import { hammerstadJensen } from '../src/analytical/hammerstad';
import { wheeler } from '../src/analytical/wheeler';
import type { MicrostripParams } from '../src/types';

/**
 * Textbook reference table for 50 Ω microstrip designs (Pozar, et al.).
 * For each substrate, the listed `width` is the canonical 50 Ω trace width.
 * Both analytical formulas should reproduce Z₀ ≈ 50 Ω within ±2 %.
 */
interface ReferenceCase {
  label: string;
  params: MicrostripParams;
  expectedZ0: number; // Ω
}

const REFERENCES: ReferenceCase[] = [
  {
    label: 'FR-4 (εr=4.4, h=1.6mm, t=0.035mm, W=3.0mm)',
    params: { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 },
    expectedZ0: 50,
  },
  {
    label: 'RO4350B (εr=3.66, h=0.508mm, t=0.018mm, W=1.13mm)',
    params: { width: 1.13, height: 0.508, thickness: 0.018, epsilonR: 3.66 },
    expectedZ0: 50,
  },
  {
    label: 'Alumina (εr=9.8, h=0.635mm, t=0.005mm, W=0.59mm)',
    params: { width: 0.59, height: 0.635, thickness: 0.005, epsilonR: 9.8 },
    expectedZ0: 50,
  },
  {
    label: 'RT/duroid 5880 (εr=2.2, h=0.787mm, t=0.018mm, W=2.40mm)',
    params: { width: 2.4, height: 0.787, thickness: 0.018, epsilonR: 2.2 },
    expectedZ0: 50,
  },
];

// CLAUDE.md §10 lists target W values with a "~" prefix (approximate).
// The Phase 1 completion criterion (§6) only mandates ±2 % for FR-4. For the
// broader sweep we allow ±3 %, since the canonical industry W values for
// non-FR-4 substrates depend on the calculator and copper thickness assumed.
const FR4_TOLERANCE_PCT = 2;
const SWEEP_TOLERANCE_PCT = 3;

function assertWithin(actual: number, expected: number, tolerancePct: number, msg: string): void {
  const errPct = (Math.abs(actual - expected) / expected) * 100;
  expect(
    errPct,
    `${msg}: ${actual.toFixed(3)} vs ${expected} (${errPct.toFixed(2)}% off)`,
  ).toBeLessThanOrEqual(tolerancePct);
}

const FR4: MicrostripParams = { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 };

describe('Hammerstad–Jensen (1980)', () => {
  it('Phase 1 completion criterion: FR-4 W=3.0mm gives Z₀ within ±2 % of 50 Ω', () => {
    const { z0 } = hammerstadJensen(FR4);
    assertWithin(z0, 50, FR4_TOLERANCE_PCT, 'FR-4 strict');
  });

  for (const { label, params, expectedZ0 } of REFERENCES) {
    it(`reproduces 50 Ω for ${label}`, () => {
      const { z0, epsilonEff } = hammerstadJensen(params);
      assertWithin(z0, expectedZ0, SWEEP_TOLERANCE_PCT, label);
      // ε_eff must lie between the static lower bound (εr+1)/2 and εr.
      expect(epsilonEff).toBeGreaterThan((params.epsilonR + 1) / 2);
      expect(epsilonEff).toBeLessThan(params.epsilonR);
    });
  }

  it('Z₀ decreases monotonically as W grows (FR-4)', () => {
    const widths = [0.5, 1.0, 2.0, 3.0, 5.0, 10.0];
    const z0s = widths.map(
      (w) => hammerstadJensen({ width: w, height: 1.6, thickness: 0.035, epsilonR: 4.4 }).z0,
    );
    for (let i = 1; i < z0s.length; i++) {
      expect(z0s[i], `Z₀ should decrease at W=${widths[i]}`).toBeLessThan(z0s[i - 1]!);
    }
  });

  it('rejects invalid inputs', () => {
    expect(() => hammerstadJensen({ width: 0, height: 1, thickness: 0, epsilonR: 4 })).toThrow();
    expect(() => hammerstadJensen({ width: 1, height: 0, thickness: 0, epsilonR: 4 })).toThrow();
    expect(() => hammerstadJensen({ width: 1, height: 1, thickness: 0, epsilonR: 0.5 })).toThrow();
  });
});

describe('Wheeler / Pozar', () => {
  it('Phase 1 completion criterion: FR-4 W=3.0mm gives Z₀ within ±2 % of 50 Ω', () => {
    const { z0 } = wheeler(FR4);
    assertWithin(z0, 50, FR4_TOLERANCE_PCT, 'FR-4 strict');
  });

  for (const { label, params, expectedZ0 } of REFERENCES) {
    it(`reproduces 50 Ω for ${label}`, () => {
      const { z0, epsilonEff } = wheeler(params);
      assertWithin(z0, expectedZ0, SWEEP_TOLERANCE_PCT, label);
      expect(epsilonEff).toBeGreaterThan((params.epsilonR + 1) / 2);
      expect(epsilonEff).toBeLessThan(params.epsilonR);
    });
  }

  it('Z₀ decreases monotonically as W grows (FR-4)', () => {
    const widths = [0.5, 1.0, 2.0, 3.0, 5.0, 10.0];
    const z0s = widths.map(
      (w) => wheeler({ width: w, height: 1.6, thickness: 0.035, epsilonR: 4.4 }).z0,
    );
    for (let i = 1; i < z0s.length; i++) {
      expect(z0s[i], `Z₀ should decrease at W=${widths[i]}`).toBeLessThan(z0s[i - 1]!);
    }
  });
});

describe('Cross-validation between Wheeler and Hammerstad–Jensen', () => {
  for (const { label, params } of REFERENCES) {
    it(`agrees within 3 % on ${label}`, () => {
      const hj = hammerstadJensen(params).z0;
      const w = wheeler(params).z0;
      const diffPct = (Math.abs(hj - w) / hj) * 100;
      expect(
        diffPct,
        `HJ=${hj.toFixed(3)} vs W=${w.toFixed(3)} (${diffPct.toFixed(2)}% diff)`,
      ).toBeLessThan(3);
    });
  }
});
