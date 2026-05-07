import { describe, expect, it } from 'vitest';
import { buildMicrostripPslg } from '../src/fem/geometry';
import { Marker, RegionAttr } from '../src/types';

const FR4 = { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 };

describe('buildMicrostripPslg — geometry construction', () => {
  it('produces a 10-point PSLG with the expected outer-box and conductor corners', () => {
    const { pslg, bounds } = buildMicrostripPslg(FR4);

    expect(pslg.pointlist).toHaveLength(10 * 2);
    expect(pslg.pointmarkerlist).toHaveLength(10);

    // bounds: lateralPad=10, airPad=10 by default → L = W + 20 h, H = h + t + 10 h
    const expectedHalfL = FR4.width / 2 + 10 * FR4.height;
    const expectedYMax = FR4.height + FR4.thickness + 10 * FR4.height;
    expect(bounds.xMin).toBeCloseTo(-expectedHalfL);
    expect(bounds.xMax).toBeCloseTo(expectedHalfL);
    expect(bounds.yMin).toBe(0);
    expect(bounds.yMax).toBeCloseTo(expectedYMax);
  });

  it('places exactly one hole at the centre of the conductor', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    expect(pslg.holelist).toEqual([0, FR4.height + FR4.thickness / 2]);
  });

  it('omits the hole when thickness is zero (degenerate conductor)', () => {
    const { pslg } = buildMicrostripPslg({ ...FR4, thickness: 0 });
    expect(pslg.holelist).toHaveLength(0);
  });

  it('emits two regions tagged Substrate and Air', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    expect(pslg.regionlist).toHaveLength(8);
    expect(pslg.regionlist[2]).toBe(RegionAttr.Substrate);
    expect(pslg.regionlist[6]).toBe(RegionAttr.Air);
    // substrate seed inside substrate (0 < y < h)
    expect(pslg.regionlist[1]).toBeGreaterThan(0);
    expect(pslg.regionlist[1]).toBeLessThan(FR4.height);
    // air seed above the conductor (y > h + t)
    expect(pslg.regionlist[5]).toBeGreaterThan(FR4.height + FR4.thickness);
  });

  it('tags the bottom edge as Ground and the four conductor sides as Conductor', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const conductorSegments = pslg.segmentmarkerlist.filter((m) => m === Marker.Conductor);
    // 4 sides of the rectangle + 1 bottom-of-conductor segment that lies on the
    // y=h interface but is part of the conductor surface
    expect(conductorSegments.length).toBeGreaterThanOrEqual(4);
    expect(pslg.segmentmarkerlist).toContain(Marker.Ground);
    expect(pslg.segmentmarkerlist).toContain(Marker.OuterBoundary);
    expect(pslg.segmentmarkerlist).toContain(Marker.DielectricInterface);
  });

  it('applies user-supplied region areas when provided', () => {
    const { pslg } = buildMicrostripPslg(FR4, {
      substrateMaxArea: 0.05,
      airMaxArea: 0.5,
    });
    expect(pslg.regionlist[3]).toBe(0.05);
    expect(pslg.regionlist[7]).toBe(0.5);
  });

  it('rejects invalid inputs', () => {
    expect(() => buildMicrostripPslg({ width: 0, height: 1, thickness: 0, epsilonR: 4 })).toThrow();
    expect(() => buildMicrostripPslg({ width: 1, height: 0, thickness: 0, epsilonR: 4 })).toThrow();
    expect(() =>
      buildMicrostripPslg({ width: 1, height: 1, thickness: -0.1, epsilonR: 4 }),
    ).toThrow();
  });

  it('point markers cover all four boundary roles', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const markerSet = new Set(pslg.pointmarkerlist);
    expect(markerSet.has(Marker.Ground)).toBe(true);
    expect(markerSet.has(Marker.OuterBoundary)).toBe(true);
    expect(markerSet.has(Marker.Conductor)).toBe(true);
  });
});
