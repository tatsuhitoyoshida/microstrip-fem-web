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

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

const METAL_COLOR = '#ed7d31';
const METAL_BORDER = '#a64b0b';
const INTERFACE_COLOR = 'rgba(231, 230, 230, 0.65)';
// Dark theme tokens — kept in sync with `--color-bg-panel`, `--color-text`,
// and `--color-text-muted` in `src/index.css`.
const PLOT_BG = '#162639';
const PLOT_PAPER_BG = '#162639';
const PLOT_TEXT = '#e7e6e6';
const PLOT_GRID = '#2c3e5a';

export interface CrossSectionPlotProps {
  result: CalcResult | null;
  /** Show a small "still working" badge over the heatmap while a solve runs. */
  isLoading?: boolean;
}

interface TriangleStats {
  /** Per-triangle |E| in dB (V/m). length = nTri. */
  eDb: Float64Array;
  /** Vertex coordinate triples per triangle (one entry of 3 (x, y) pairs). */
  triXs: number[][];
  triYs: number[][];
  /** Lowest dB value displayed (clipped at DB_FLOOR_BELOW_MAX below the max). */
  eDbMin: number;
  /** Highest dB value, capped at the 99th percentile so the corner-edge
   *  singularity doesn't compress the rest of the field. */
  eDbMax: number;
}

/**
 * Drive voltage is V_drive = 1 V; vertex coordinates are in mm. So |∇φ| comes
 * out in V/mm; multiply by 1000 to get V/m before taking dB.
 */
const MM_TO_M = 1000;
/** Plot dynamic range below the (saturated) peak. */
const DB_FLOOR_BELOW_MAX = 60;

function computeTriangleStats(result: CalcResult): TriangleStats {
  const { mesh, phi } = result.fem;
  const nTri = mesh.triangleCount;
  const eMag = new Float64Array(nTri);
  const triXs: number[][] = new Array(nTri);
  const triYs: number[][] = new Array(nTri);

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
    // |∇φ| in V/mm — convert to V/m for the absolute-dB scale.
    eMag[t] = Math.sqrt(dx * dx + dy * dy) * MM_TO_M;
    triXs[t] = [x0, x1, x2];
    triYs[t] = [y0, y1, y2];
  }

  // Cap the colour-bar maximum at the 99th-percentile dB value: the conductor
  // corner singularity drives the raw max up by ~20–40 dB and would otherwise
  // squash everyone else into the bottom two bins. Floor 60 dB below that
  // cap so the dynamic range is always 60 dB regardless of geometry.
  const sorted = Float64Array.from(eMag).sort();
  const eMagCap = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 1;
  const eDbMax = eMagCap > 0 ? 20 * Math.log10(eMagCap) : 0;
  const eDbMin = eDbMax - DB_FLOOR_BELOW_MAX;

  const eDb = new Float64Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const m = eMag[t]!;
    // Below 10^(eDbMin / 20) V/m we just clip — anything that quiet won't
    // help the user understand the field structure.
    eDb[t] = m > 0 ? Math.max(eDbMin, 20 * Math.log10(m)) : eDbMin;
  }

  return { eDb, triXs, triYs, eDbMin, eDbMax };
}

interface PlotLabels {
  colorbar: string;
  conductor: string;
  ground: string;
  interface: string;
}

function buildTraces(result: CalcResult, stats: TriangleStats, labels: PlotLabels): Plotly.Data[] {
  const { triXs, triYs, eDb, eDbMin, eDbMax } = stats;
  const range = eDbMax - eDbMin || 1;

  const buckets: { xs: (number | null)[]; ys: (number | null)[] }[] = Array.from(
    { length: N_BINS },
    () => ({ xs: [], ys: [] }),
  );

  for (let t = 0; t < eDb.length; t++) {
    const norm = Math.min(1, Math.max(0, (eDb[t]! - eDbMin) / range));
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
    x: [eDbMin, eDbMax],
    y: [0, 0],
    z: [[eDbMin, eDbMax]],
    colorscale: VIRIDIS_24.map((c, i) => [i / (VIRIDIS_24.length - 1), c]),
    showscale: true,
    opacity: 0,
    hoverinfo: 'skip',
    colorbar: {
      title: { text: labels.colorbar, font: { color: '#e7e6e6' } },
      tickfont: { color: '#e7e6e6' },
      outlinecolor: '#2c3e5a',
      len: 0.8,
    },
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

/** Build the layout object — cheap (~ms), so rebuilt on every paint. */
function buildLayout(result: CalcResult, t: TFunction): Partial<Plotly.Layout> {
  const { height: h, thickness: tk, epsilonR } = result.paramsUsed;
  const { xMin, xMax, yMin, yMax } = result.fem.bounds;
  // Anchor the substrate / air labels to the left edge so they don't
  // collide with the conductor or its field singularity.
  const annoX = xMin + 0.04 * (xMax - xMin);
  const labelStyle = {
    showarrow: false,
    font: { color: PLOT_TEXT, size: 12 },
    bgcolor: 'rgba(15, 27, 45, 0.78)',
    bordercolor: PLOT_GRID,
    borderwidth: 1,
    borderpad: 3,
    xanchor: 'left' as const,
  };
  // Lock the view to the geometry bounds. The combination of
  // `scaleanchor: 'y' + scaleratio: 1` (1:1 aspect) and explicit ranges
  // is over-determined when the canvas aspect doesn't match the data
  // aspect — without `constrain: 'domain'` Plotly resolves it by
  // **expanding the range** to fill the canvas, which makes the heatmap
  // shrink visually on every resize (and the effect compounds because
  // `uirevision` then locks in the expanded range). `constrain: 'domain'`
  // tells Plotly to instead **shrink the plotting domain** (leaving
  // whitespace inside the canvas) so the heatmap always renders at its
  // full data range, as large as possible. `uirevision` is a constant
  // string so the user's manual pan / zoom is preserved across
  // re-renders within the same calculation; it changes only when the
  // cross-section geometry itself does (e.g. new W from Find-W).
  const uirevision = `${xMin}:${xMax}:${yMin}:${yMax}`;
  return {
    paper_bgcolor: PLOT_PAPER_BG,
    plot_bgcolor: PLOT_BG,
    font: { color: PLOT_TEXT, family: 'Calibri, Inter, sans-serif' },
    xaxis: {
      title: { text: t('plot.xAxis'), font: { color: PLOT_TEXT } },
      tickfont: { color: PLOT_TEXT },
      gridcolor: PLOT_GRID,
      zerolinecolor: PLOT_GRID,
      linecolor: PLOT_GRID,
      scaleanchor: 'y',
      scaleratio: 1,
      range: [xMin, xMax],
      autorange: false,
      constrain: 'domain',
    },
    yaxis: {
      title: { text: t('plot.yAxis'), font: { color: PLOT_TEXT } },
      tickfont: { color: PLOT_TEXT },
      gridcolor: PLOT_GRID,
      zerolinecolor: PLOT_GRID,
      linecolor: PLOT_GRID,
      range: [yMin, yMax],
      autorange: false,
      constrain: 'domain',
    },
    uirevision,
    margin: { t: 20, r: 20, b: 50, l: 60 },
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
}

export function CrossSectionPlot({
  result,
  isLoading,
}: CrossSectionPlotProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  /**
   * Tracks which `result` is currently painted on the Plotly node, so the
   * label-only effect (which reacts to `t` changes) can verify the heavy
   * effect has already finished and skip otherwise. This is what makes the
   * language switch fast: when only `t` changes, we update axis titles /
   * annotations / colorbar via Plotly.relayout + restyle and skip the
   * polygon redraw entirely.
   */
  const renderedResult = useRef<CalcResult | null>(null);

  // Heavy: |E| computation + bucket sort. Recomputed only on result change.
  const stats = useMemo(() => (result ? computeTriangleStats(result) : null), [result]);

  // Trace shape doesn't depend on language at the visible level — colorbar
  // text is the only user-facing label and we update it via Plotly.restyle
  // in the lightweight effect below. So memoising on [result, stats] (no t)
  // means a language switch reuses the same trace objects.
  const traces = useMemo(() => {
    if (!result || !stats) return null;
    const labels: PlotLabels = {
      colorbar: t('plot.colorbar'),
      conductor: t('plot.conductor'),
      ground: t('plot.ground'),
      interface: t('plot.interface'),
    };
    return buildTraces(result, stats, labels);
    // `t` deliberately omitted: label changes are pushed via Plotly.relayout
    // / restyle in the lightweight effect below, not by rebuilding traces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, stats]);

  // Heavy effect: full Plotly.react when the result (and therefore traces)
  // changes. Does NOT depend on `t`, so language switches don't trigger
  // a polygon redraw.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void (async () => {
      const Plotly = (await loadPlotly()).default;
      if (cancelled || !ref.current) return;
      if (!result || !traces) {
        Plotly.purge(node);
        renderedResult.current = null;
        return;
      }
      const layout = buildLayout(result, t);
      void Plotly.react(node, traces, layout, { responsive: true, displaylogo: false });
      renderedResult.current = result;
    })();
    return () => {
      cancelled = true;
    };
    // `t` deliberately omitted: language changes are handled by the
    // lightweight relayout/restyle effect below; we don't want them to
    // trigger a full polygon redraw here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, traces]);

  // Lightweight effect: when only `t` changes (same result already drawn),
  // push the new labels via Plotly.relayout (axis titles, annotations) and
  // Plotly.restyle (colorbar title). Skips the polygon rebuild entirely.
  useEffect(() => {
    const node = ref.current;
    if (!node || !result) return;
    // Bail if the heavy effect hasn't drawn this result yet — it'll paint
    // the correct labels in the first place.
    if (renderedResult.current !== result) return;
    let cancelled = false;
    void (async () => {
      const Plotly = (await loadPlotly()).default;
      if (cancelled || !ref.current) return;
      const { height: h, thickness: tk, epsilonR } = result.paramsUsed;
      const { xMin, xMax, yMax } = result.fem.bounds;
      const annoX = xMin + 0.04 * (xMax - xMin);
      const subY = h * 0.5;
      const airY = h + tk + 0.5 * (yMax - h - tk);
      // Plotly accepts dot-path keys at runtime ("title.text" etc.) but the
      // public TS types only know about the nested form, so we cast the
      // update payload through `unknown`.
      const labelStyle = {
        showarrow: false,
        font: { color: PLOT_TEXT, size: 12 },
        bgcolor: 'rgba(15, 27, 45, 0.78)',
        bordercolor: PLOT_GRID,
        borderwidth: 1,
        borderpad: 3,
        xanchor: 'left' as const,
      };
      const layoutUpdate = {
        'xaxis.title.text': t('plot.xAxis'),
        'yaxis.title.text': t('plot.yAxis'),
        // Annotations is a whole-array replacement, so resupply every field.
        annotations: [
          {
            ...labelStyle,
            x: annoX,
            y: subY,
            text: t('plot.substrateLabel', { er: epsilonR.toFixed(2) }),
          },
          {
            ...labelStyle,
            x: annoX,
            y: airY,
            text: t('plot.airLabel'),
          },
        ],
      } as unknown as Partial<Plotly.Layout>;
      void Plotly.relayout(node, layoutUpdate);
      // Colorbar title lives on the dummy heatmap trace at index N_BINS
      // (see buildTraces — buckets are pushed first, then the heatmap).
      const restyleUpdate = {
        'colorbar.title.text': t('plot.colorbar'),
      } as unknown as Partial<Plotly.PlotData>;
      void Plotly.restyle(node, restyleUpdate, [N_BINS]);
    })();
    return () => {
      cancelled = true;
    };
  }, [t, result]);

  return (
    <section
      className={`cross-section-plot${isLoading ? ' cross-section-plot--loading' : ''}`}
    >
      <h2>{t('plot.panelTitle')}</h2>
      <div ref={ref} className="cross-section-plot__canvas" />
      {isLoading && (
        <div className="cross-section-plot__loading-badge" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {t('plot.working')}
        </div>
      )}
      {!result && <p className="hint cross-section-plot__hint">{t('plot.empty')}</p>}
    </section>
  );
}
