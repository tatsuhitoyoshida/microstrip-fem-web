/**
 * Cross-section visualisation: per-triangle |E| heatmap (binned filled
 * polygons) plus the conductor outline.
 *
 * |E| is constant within each linear T3 element, computed from the FEM
 * shape-function gradients:
 *   ∂φ/∂x = Σ b_i φ_i,  ∂φ/∂y = Σ c_i φ_i,  |E| = √((∂φ/∂x)² + (∂φ/∂y)²)
 *
 * For Plotly we bin the |E| range into N levels and emit one filled-scatter
 * trace per bin (each containing all triangles in that bin). A separate
 * dummy heatmap trace carries the colorbar.
 */

import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { CalcResult } from '../hooks/useMicrostripCalc';

const N_BINS = 12;
const VIRIDIS_12 = [
  '#440154',
  '#482475',
  '#414487',
  '#355f8d',
  '#2a788e',
  '#21908d',
  '#22a884',
  '#44bf70',
  '#7ad151',
  '#bddf26',
  '#fde725',
  '#fffbd5',
];

export interface CrossSectionPlotProps {
  result: CalcResult | null;
}

interface TriangleStats {
  /** Per-triangle |E| (length = nTri). */
  e: Float64Array;
  /** Vertex coordinate triples per triangle (one entry of 3 (x, y) pairs). */
  triXs: number[][];
  triYs: number[][];
  eMin: number;
  eMax: number;
}

function computeTriangleStats(result: CalcResult): TriangleStats {
  const { mesh, phi } = result.fem;
  const nTri = mesh.triangleCount;
  const e = new Float64Array(nTri);
  const triXs: number[][] = new Array(nTri);
  const triYs: number[][] = new Array(nTri);
  let eMin = Infinity;
  let eMax = -Infinity;

  for (let t = 0; t < nTri; t++) {
    const i0 = mesh.triangles[3 * t]!;
    const i1 = mesh.triangles[3 * t + 1]!;
    const i2 = mesh.triangles[3 * t + 2]!;
    const x0 = mesh.vertices[2 * i0]!;
    const y0 = mesh.vertices[2 * i0 + 1]!;
    const x1 = mesh.vertices[2 * i1]!;
    const y1 = mesh.vertices[2 * i1 + 1]!;
    const x2 = mesh.vertices[2 * i2]!;
    const y2 = mesh.vertices[2 * i2 + 1]!;
    const twoA = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const inv2A = 1 / twoA;
    const b0 = (y1 - y2) * inv2A;
    const b1 = (y2 - y0) * inv2A;
    const b2 = (y0 - y1) * inv2A;
    const c0 = (x2 - x1) * inv2A;
    const c1 = (x0 - x2) * inv2A;
    const c2 = (x1 - x0) * inv2A;
    const dx = b0 * phi[i0]! + b1 * phi[i1]! + b2 * phi[i2]!;
    const dy = c0 * phi[i0]! + c1 * phi[i1]! + c2 * phi[i2]!;
    const mag = Math.sqrt(dx * dx + dy * dy);
    e[t] = mag;
    if (mag < eMin) eMin = mag;
    if (mag > eMax) eMax = mag;
    triXs[t] = [x0, x1, x2];
    triYs[t] = [y0, y1, y2];
  }
  return { e, triXs, triYs, eMin, eMax };
}

function buildTraces(result: CalcResult, stats: TriangleStats): Plotly.Data[] {
  const { triXs, triYs, e, eMin, eMax } = stats;
  // Saturate the upper end at 99th percentile so the corner singularities
  // don't wash out the rest of the field. (Phase 8 will let the user
  // override this.)
  const sorted = Float64Array.from(e).sort();
  const eClipMax = sorted[Math.floor(sorted.length * 0.99)] ?? eMax;
  const range = eClipMax - eMin || 1;

  const buckets: { xs: (number | null)[]; ys: (number | null)[] }[] = Array.from(
    { length: N_BINS },
    () => ({ xs: [], ys: [] }),
  );

  for (let t = 0; t < e.length; t++) {
    const norm = Math.min(1, Math.max(0, (e[t]! - eMin) / range));
    const bin = Math.min(N_BINS - 1, Math.floor(norm * N_BINS));
    const tri = buckets[bin]!;
    const xs = triXs[t]!;
    const ys = triYs[t]!;
    tri.xs.push(xs[0]!, xs[1]!, xs[2]!, xs[0]!, null);
    tri.ys.push(ys[0]!, ys[1]!, ys[2]!, ys[0]!, null);
  }

  const traces: Plotly.Data[] = buckets.map((b, bin) => {
    const color = VIRIDIS_12[bin] ?? '#222';
    return {
      type: 'scatter',
      mode: 'lines',
      x: b.xs,
      y: b.ys,
      fill: 'toself',
      fillcolor: color,
      line: { color, width: 0.2 },
      hoverinfo: 'skip',
      showlegend: false,
    };
  });

  // Dummy heatmap to render a colorbar with the right scale.
  traces.push({
    type: 'heatmap',
    x: [eMin, eClipMax],
    y: [0, 0],
    z: [[eMin, eClipMax]],
    colorscale: VIRIDIS_12.map((c, i) => [i / (VIRIDIS_12.length - 1), c]),
    showscale: true,
    opacity: 0,
    hoverinfo: 'skip',
    colorbar: { title: { text: '|E|  [V/length]' }, len: 0.8 },
  } as Plotly.Data);

  // Conductor outline.
  const { width: W, height: h, thickness: t } = result.paramsUsed;
  const halfW = W / 2;
  traces.push({
    type: 'scatter',
    mode: 'lines',
    x: [-halfW, halfW, halfW, -halfW, -halfW],
    y: [h, h, h + t, h + t, h],
    line: { color: '#dd2222', width: 2 },
    name: 'Conductor',
    hoverinfo: 'skip',
    showlegend: false,
  });

  return traces;
}

export function CrossSectionPlot({ result }: CrossSectionPlotProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!result) {
      void Plotly.purge(ref.current);
      return;
    }
    const stats = computeTriangleStats(result);
    const traces = buildTraces(result, stats);
    const layout: Partial<Plotly.Layout> = {
      title: { text: 'Cross-section · |E| heatmap' },
      xaxis: { title: { text: 'x [mm]' }, scaleanchor: 'y', scaleratio: 1 },
      yaxis: { title: { text: 'y [mm]' } },
      margin: { t: 50, r: 20, b: 50, l: 60 },
      showlegend: false,
    };
    void Plotly.react(ref.current, traces, layout, { responsive: true, displaylogo: false });
  }, [result]);

  return (
    <section className="cross-section-plot">
      <div ref={ref} style={{ width: '100%', height: 500 }} />
      {!result && <p className="hint cross-section-plot__hint">No mesh yet.</p>}
    </section>
  );
}
