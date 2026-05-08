// @vitest-environment node
// triangle-wasm's Emscripten loader sniffs `typeof window === 'object'` to
// pick between fetch (browser) and fs (Node). Forcing the Node environment
// here, paired with the WebAssembly.instantiateStreaming shim in
// `tests/setup.ts`, drives the loader through the Node fs path.
import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { buildMicrostripPslg } from '../src/fem/geometry';
import { initMesh, meshFromPslg } from '../src/fem/mesh';
import { Marker, RegionAttr } from '../src/types';

// triangle-wasm's Emscripten loader detects Node first (even under jsdom) and
// reads the .wasm via fs.readFileSync, so we hand it a plain filesystem path.
const WASM_PATH = path
  .resolve(process.cwd(), 'node_modules/triangle-wasm/triangle.out.wasm')
  .replace(/\\/g, '/');

const FR4 = { width: 3.0, height: 1.6, thickness: 0.035, epsilonR: 4.4 };

describe('mesh generation — triangle-wasm integration', () => {
  beforeAll(async () => {
    await initMesh(WASM_PATH);
  });

  it('meshes the FR-4 microstrip with min angle ≥ 25°', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    expect(mesh.minAngleDeg).toBeGreaterThanOrEqual(25);
    expect(mesh.triangleCount).toBeGreaterThan(500);
    expect(mesh.triangleCount).toBeLessThan(100000);
  });

  it('every triangle is tagged with a known region attribute', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    const validAttrs = new Set<number>([RegionAttr.Substrate, RegionAttr.Air]);
    for (let i = 0; i < mesh.triangleAttributes.length; i++) {
      expect(validAttrs.has(mesh.triangleAttributes[i]!)).toBe(true);
    }
  });

  it('substrate and air regions both have triangles', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    const substrateCount = Array.from(mesh.triangleAttributes).filter(
      (a) => a === RegionAttr.Substrate,
    ).length;
    const airCount = Array.from(mesh.triangleAttributes).filter((a) => a === RegionAttr.Air).length;
    expect(substrateCount).toBeGreaterThan(100);
    expect(airCount).toBeGreaterThan(100);
  });

  it('respects per-region area constraints (smaller area → more triangles)', () => {
    const coarse = buildMicrostripPslg(FR4, { substrateMaxArea: 1.0, airMaxArea: 5.0 });
    const fine = buildMicrostripPslg(FR4, { substrateMaxArea: 0.05, airMaxArea: 0.5 });
    const coarseMesh = meshFromPslg(coarse.pslg);
    const fineMesh = meshFromPslg(fine.pslg);
    expect(fineMesh.triangleCount).toBeGreaterThan(coarseMesh.triangleCount * 1.5);
  });

  it('preserves boundary markers on output vertices', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    const markers = new Set(Array.from(mesh.vertexMarkers));
    expect(markers.has(Marker.Ground)).toBe(true);
    expect(markers.has(Marker.OuterBoundary)).toBe(true);
    expect(markers.has(Marker.Conductor)).toBe(true);
  });

  it('all triangle vertex indices are in range', () => {
    const { pslg } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    const nVerts = mesh.vertices.length / 2;
    for (let i = 0; i < mesh.triangles.length; i++) {
      const v = mesh.triangles[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(nVerts);
    }
  });

  it('mesh bounds match the geometry domain (no triangles inside the conductor)', () => {
    const { pslg, bounds } = buildMicrostripPslg(FR4);
    const mesh = meshFromPslg(pslg);
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < mesh.vertices.length; i += 2) {
      const x = mesh.vertices[i]!;
      const y = mesh.vertices[i + 1]!;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    expect(xMin).toBeCloseTo(bounds.xMin, 6);
    expect(xMax).toBeCloseTo(bounds.xMax, 6);
    expect(yMin).toBeCloseTo(bounds.yMin, 6);
    expect(yMax).toBeCloseTo(bounds.yMax, 6);

    // No triangle centroid should lie strictly inside the conductor rectangle.
    const halfW = FR4.width / 2;
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const a = mesh.triangles[i]!;
      const b = mesh.triangles[i + 1]!;
      const c = mesh.triangles[i + 2]!;
      const cx = (mesh.vertices[2 * a]! + mesh.vertices[2 * b]! + mesh.vertices[2 * c]!) / 3;
      const cy =
        (mesh.vertices[2 * a + 1]! + mesh.vertices[2 * b + 1]! + mesh.vertices[2 * c + 1]!) / 3;
      const insideConductor =
        cx > -halfW && cx < halfW && cy > FR4.height && cy < FR4.height + FR4.thickness;
      expect(insideConductor).toBe(false);
    }
  });
});
