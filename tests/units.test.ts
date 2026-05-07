import { describe, expect, it } from 'vitest';
import { fromMm, formatLength, MIL_TO_MM, toMm } from '../src/lib/units';

describe('units conversion', () => {
  it('toMm is identity for mm and scales for mil', () => {
    expect(toMm(3, 'mm')).toBe(3);
    expect(toMm(118.110_236_22, 'mil')).toBeCloseTo(3.0, 6);
    expect(toMm(1, 'mil')).toBe(MIL_TO_MM);
  });

  it('fromMm round-trips toMm', () => {
    for (const unit of ['mm', 'mil'] as const) {
      for (const v of [0.1, 1.0, 50, 1234.567]) {
        expect(toMm(fromMm(v, unit), unit)).toBeCloseTo(v, 9);
      }
    }
  });

  it('formatLength produces expected strings', () => {
    expect(formatLength(3.0, 'mm')).toBe('3.000 mm');
    expect(formatLength(3.0, 'mil', 1)).toBe('118.1 mil');
    expect(formatLength(0.0254, 'mil', 3)).toBe('1.000 mil');
  });
});
