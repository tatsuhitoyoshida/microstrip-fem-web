/**
 * Unit-conversion helpers for the parameter form.
 * Internally the FEM and analytical formulas always work in mm; the UI
 * lets the user enter and read values in mm or mil.
 */

/** 1 mil = 0.0254 mm exactly. */
export const MIL_TO_MM = 0.0254;

export type LengthUnit = 'mm' | 'mil';

export function toMm(value: number, unit: LengthUnit): number {
  return unit === 'mm' ? value : value * MIL_TO_MM;
}

export function fromMm(valueMm: number, unit: LengthUnit): number {
  return unit === 'mm' ? valueMm : valueMm / MIL_TO_MM;
}

/** Pretty-print a length in the chosen unit, with sensible precision. */
export function formatLength(valueMm: number, unit: LengthUnit, fractionDigits = 3): string {
  const v = fromMm(valueMm, unit);
  return `${v.toFixed(fractionDigits)} ${unit}`;
}
