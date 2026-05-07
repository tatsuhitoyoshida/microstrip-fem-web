/**
 * Debug-only Plotly view of the microstrip mesh. Renders triangle edges
 * coloured by region (substrate = blue, air = grey) with the conductor
 * outline overlaid in red. Used to visually verify the geometry / mesh
 * before the FEM solver pipeline lands. Phase 6 will replace this with the
 * proper CrossSectionPlot showing |E|.
 */

import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { buildMicrostripPslg } from '../fem/geometry';
import { initMesh, meshFromPslg } from '../fem/mesh';
import { type Mesh, type MicrostripParams, RegionAttr } from '../types';

const FR4_DEFAULT: MicrostripParams = {
  width: 3.0,
  height: 1.6,
  thickness: 0.035,
  epsilonR: 4.4,
};

interface RegionEdges {
  xs: (number | null)[];
  ys: (number | null)[];
}

/** Decompose a mesh into per-region edge polylines (with `null` breaks between triangles). */
function buildEdgeTraces(mesh: Mesh): { substrate: RegionEdges; air: RegionEdges } {
  const substrate: RegionEdges = { xs: [], ys: [] };
  const air: RegionEdges = { xs: [], ys: [] };

  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const i0 = mesh.triangles[t]!;
    const i1 = mesh.triangles[t + 1]!;
    const i2 = mesh.triangles[t + 2]!;
    const attr = mesh.triangleAttributes[t / 3]!;
    const target = attr === RegionAttr.Substrate ? substrate : air;
    target.xs.push(
      mesh.vertices[2 * i0]!,
      mesh.vertices[2 * i1]!,
      mesh.vertices[2 * i2]!,
      mesh.vertices[2 * i0]!,
      null,
    );
    target.ys.push(
      mesh.vertices[2 * i0 + 1]!,
      mesh.vertices[2 * i1 + 1]!,
      mesh.vertices[2 * i2 + 1]!,
      mesh.vertices[2 * i0 + 1]!,
      null,
    );
  }
  return { substrate, air };
}

export function MeshDebugView(): React.ReactElement {
  const plotRef = useRef<HTMLDivElement>(null);
  const [mesh, setMesh] = useState<Mesh | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initMesh('/triangle.out.wasm');
        const { pslg } = buildMicrostripPslg(FR4_DEFAULT);
        const m = meshFromPslg(pslg);
        if (!cancelled) setMesh(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mesh || !plotRef.current) return;
    const { substrate, air } = buildEdgeTraces(mesh);
    const params = FR4_DEFAULT;
    const halfW = params.width / 2;
    const conductor = {
      x: [-halfW, halfW, halfW, -halfW, -halfW],
      y: [
        params.height,
        params.height,
        params.height + params.thickness,
        params.height + params.thickness,
        params.height,
      ],
    };

    void Plotly.newPlot(
      plotRef.current,
      [
        {
          x: air.xs,
          y: air.ys,
          mode: 'lines',
          line: { color: '#cccccc', width: 0.5 },
          name: 'Air mesh',
          hoverinfo: 'skip',
        },
        {
          x: substrate.xs,
          y: substrate.ys,
          mode: 'lines',
          line: { color: '#5577dd', width: 0.5 },
          name: 'Substrate mesh',
          hoverinfo: 'skip',
        },
        {
          x: conductor.x,
          y: conductor.y,
          mode: 'lines',
          line: { color: '#dd2222', width: 2 },
          name: 'Conductor',
          fill: 'toself',
          fillcolor: 'rgba(221,34,34,0.15)',
          hoverinfo: 'skip',
        },
      ] as Plotly.Data[],
      {
        title: { text: 'Microstrip cross-section mesh (debug)' },
        xaxis: { title: { text: 'x [mm]' }, scaleanchor: 'y', scaleratio: 1 },
        yaxis: { title: { text: 'y [mm]' } },
        showlegend: true,
        margin: { t: 50, r: 20, b: 50, l: 60 },
      },
      { responsive: true, displaylogo: false },
    );
  }, [mesh]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Mesh debug view (Phase 2)</h2>
      <p>Default FR-4 microstrip — εr = 4.4, h = 1.6 mm, W = 3.0 mm, t = 0.035 mm.</p>
      {error && <pre style={{ color: 'crimson' }}>Error: {error}</pre>}
      {mesh && (
        <p>
          {mesh.triangleCount.toLocaleString()} triangles · min interior angle ={' '}
          {mesh.minAngleDeg.toFixed(2)}°
        </p>
      )}
      {!mesh && !error && <p>Loading mesh…</p>}
      <div ref={plotRef} style={{ width: '100%', height: 600 }} />
    </div>
  );
}
