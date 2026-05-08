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
import { useTranslation } from 'react-i18next';
// Type-only import — the runtime module is loaded lazily inside the effect
// below so Plotly stays out of the initial bundle (CLAUDE.md §6 Phase 8).
import type * as Plotly from 'plotly.js';
import type { CalcResult } from '../hooks/useMicrostripCalc';

type PlotlyModule = typeof import('plotly.js-dist-min');
let plotlyModulePromise: Promise<PlotlyModule> | null = null;
function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyModulePromise) plotlyModulePromise = import('plotly.js-dist-min');
  return plotlyModulePromise;
}

// More bins → smoother colour gradient on the heatmap (the per-bin scatter
// traces dwarf the gradient resolution otherwise).
const N_BINS = 24;
const VIRIDIS_24 = [
  '#440154',
  '#481467',
  '#482576',
  '#463480',
  '#414487',
  '#3b528b',
  '#355f8d',
  '#2f6c8e',
  '#2a788e',
  '#26828e',
  '#21908d',
  '#1f9c89',
  '#22a884',
  '#2eb37c',
  '#44bf70',
  '#5cc863',
  '#7ad151',
  '#94d840',
  '#b0dd2f',
  '#c8e020',
  '#dde318',
  '#ece51b',
  '#f5e923',
  '#fde725',
];

const METAL_COLOR = '#dd2222';
const METAL_BORDER = '#8a1111';
const INTERFACE_COLOR = 'rgba(245, 245, 245, 0.85)';

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

interface PlotLabels {
  colorbar: string;
  conductor: string;
  ground: string;
  interface: string;
}

function buildTraces(result: CalcResult, stats: TriangleStats, labels: PlotLabels): Plotly.Data[] {
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
    const color = VIRIDIS_24[bin] ?? '#222';
    return {
      type: 'scatter',
      mode: 'lines',
      x: b.xs,
      y: b.ys,
      fill: 'toself',
      fillcolor: color,
      // Match the line colour to the fill so triangle edges blend into a
      // smooth field; setting width=0 leaves single-pixel artefacts in
      // some renderers, so a same-colour line of nominal width is safer.
      line: { color, width: 0.5 },
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
    colorscale: VIRIDIS_24.map((c, i) => [i / (VIRIDIS_24.length - 1), c]),
    showscale: true,
    opacity: 0,
    hoverinfo: 'skip',
    colorbar: { title: { text: labels.colorbar }, len: 0.8 },
  } as Plotly.Data);

  // Substrate–air interface (dashed, broken around the conductor footprint).
  const { width: W, height: h, thickness: t } = result.paramsUsed;
  const halfW = W / 2;
  const { xMin, xMax } = result.fem.bounds;
  traces.push({
    type: 'scatter',
    mode: 'lines',
    x: [xMin, -halfW, null, halfW, xMax],
    y: [h, h, null, h, h],
    line: { color: INTERFACE_COLOR, width: 0.7, dash: 'dash' },
    name: labels.interface,
    hoverinfo: 'skip',
    showlegend: false,
  });

  // Ground plane — same red treatment as the signal conductor, drawn as a
  // thick line along y = 0 across the full domain.
  traces.push({
    type: 'scatter',
    mode: 'lines',
    x: [xMin, xMax],
    y: [0, 0],
    line: { color: METAL_COLOR, width: 3 },
    name: labels.ground,
    hoverinfo: 'skip',
    showlegend: false,
  });

  // Signal conductor — filled red rectangle so it visually reads as a metal
  // block (the FEM treats this region as a hole, so the heatmap doesn't
  // bleed into it).
  traces.push({
    type: 'scatter',
    mode: 'lines',
    x: [-halfW, halfW, halfW, -halfW, -halfW],
    y: [h, h, h + t, h + t, h],
    fill: 'toself',
    fillcolor: METAL_COLOR,
    line: { color: METAL_BORDER, width: 1 },
    name: labels.conductor,
    hoverinfo: 'skip',
    showlegend: false,
  });

  return traces;
}

export function CrossSectionPlot({ result }: CrossSectionPlotProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void (async () => {
      const Plotly = (await loadPlotly()).default;
      if (cancelled || !ref.current) return;
      if (!result) {
        Plotly.purge(node);
        return;
      }
      const stats = computeTriangleStats(result);
      const labels: PlotLabels = {
        colorbar: t('plot.colorbar'),
        conductor: t('plot.conductor'),
        ground: t('plot.ground'),
        interface: t('plot.interface'),
      };
      const traces = buildTraces(result, stats, labels);
      const { height: h, thickness: tk, epsilonR } = result.paramsUsed;
      const { xMin, xMax, yMax } = result.fem.bounds;
      // Anchor the substrate / air labels to the left edge so they don't
      // collide with the conductor or its field singularity.
      const annoX = xMin + 0.04 * (xMax - xMin);
      const labelStyle = {
        showarrow: false,
        font: { color: '#1f2933', size: 11 },
        bgcolor: 'rgba(255,255,255,0.78)',
        borderpad: 2,
        xanchor: 'left' as const,
      };
      const layout: Partial<Plotly.Layout> = {
        title: { text: t('plot.title') },
        xaxis: { title: { text: t('plot.xAxis') }, scaleanchor: 'y', scaleratio: 1 },
        yaxis: { title: { text: t('plot.yAxis') } },
        margin: { t: 50, r: 20, b: 50, l: 60 },
        showlegend: false,
        annotations: [
          {
            ...labelStyle,
            x: annoX,
            y: h * 0.5,
            text: t('plot.substrateLabel', { er: epsilonR.toFixed(2) }),
          },
          {
            ...labelStyle,
            x: annoX,
            y: h + tk + 0.5 * (yMax - h - tk),
            text: t('plot.airLabel'),
          },
        ],
      };
      void Plotly.react(node, traces, layout, { responsive: true, displaylogo: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [result, t]);

  return (
    <section className="cross-section-plot">
      <div ref={ref} className="cross-section-plot__canvas" />
      {!result && <p className="hint cross-section-plot__hint">{t('plot.empty')}</p>}
    </section>
  );
}
