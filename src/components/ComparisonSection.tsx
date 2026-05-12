/**
 * Three side-by-side parameter sweeps that show how Hammerstad–Jensen
 * and Wheeler closed-form Z₀ predictions disagree, and where the FEM
 * answer lands. The analytical curves are drawn from precomputed
 * samples (cheap arithmetic); the FEM markers are filled in
 * progressively by a private Web Worker that processes a queue of
 * geometries one at a time.
 *
 * The worker is dedicated to this component — it never sees the main
 * calculator hook's state — so the live calculator panel keeps working
 * while the comparison gallery slowly populates in the background.
 * On unmount (back-to-calculator click) the worker is terminated.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Plotly from 'plotly.js';
import { hammerstadJensen } from '../analytical/hammerstad';
import { wheeler } from '../analytical/wheeler';
import type { MicrostripParams } from '../types';
import type { WorkerRequest, WorkerResponse } from '../workers/messages';
import FemWorker from '../workers/femWorker.ts?worker';

type PlotlyModule = typeof import('plotly.js-dist-min');
let plotlyModulePromise: Promise<PlotlyModule> | null = null;
function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyModulePromise) plotlyModulePromise = import('plotly.js-dist-min');
  return plotlyModulePromise;
}

const COLOR_FEM = '#e91e8c';
const COLOR_HJ = '#ed7d31';
const COLOR_WHEELER = '#9ba8bd';
const PLOT_BG = '#162639';
const PLOT_TEXT = '#e7e6e6';
const PLOT_GRID = '#2c3e5a';

type SweepId = 'w' | 'eps' | 't';

interface SweepConfig {
  id: SweepId;
  /** Display-unit x values for analytical curves (~50 points). */
  xAnalytical: number[];
  /** Display-unit x values where FEM markers are wanted (~6 points). */
  xFem: number[];
  /** Convert a display-unit x to MicrostripParams (all-mm). */
  paramsFor: (x: number) => MicrostripParams;
  /** i18next key for the x-axis label. */
  xAxisKey: string;
  /** i18next key for the figure title. */
  titleKey: string;
  /** i18next key for the figure caption. */
  captionKey: string;
  /** Optional log-x for sweeps that span more than a decade. */
  logX?: boolean;
}

/** Lay out N points evenly between `a` and `b` (linear). */
function linspace(a: number, b: number, n: number): number[] {
  if (n < 2) return [a];
  const out = new Array<number>(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

const FR4_EPS = 4.4;

/**
 * Build the three sweep configurations. Display units are chosen to
 * read well on the axis labels:
 *   - W in mm
 *   - ε_r dimensionless
 *   - t in µm (converted to mm before passing to the FEM)
 */
const SWEEPS: SweepConfig[] = [
  {
    id: 'w',
    xAnalytical: linspace(0.2, 4.0, 50),
    xFem: [0.3, 0.6, 1.0, 1.6, 2.5, 3.5],
    paramsFor: (W) => ({ width: W, height: 1.6, thickness: 0.035, epsilonR: FR4_EPS }),
    xAxisKey: 'details.sec4.xAxisW',
    titleKey: 'details.sec4.plot1Title',
    captionKey: 'details.sec4.plot1Caption',
  },
  {
    id: 'eps',
    xAnalytical: linspace(2.0, 11.0, 50),
    xFem: [2.2, 3.66, 4.4, 6.0, 9.8],
    paramsFor: (er) => ({ width: 1.0, height: 0.5, thickness: 0.035, epsilonR: er }),
    xAxisKey: 'details.sec4.xAxisEps',
    titleKey: 'details.sec4.plot2Title',
    captionKey: 'details.sec4.plot2Caption',
  },
  {
    id: 't',
    xAnalytical: linspace(5, 105, 50),
    xFem: [5, 18, 35, 70, 105],
    paramsFor: (tUm) => ({
      width: 1.0,
      height: 0.5,
      thickness: tUm / 1000,
      epsilonR: FR4_EPS,
    }),
    xAxisKey: 'details.sec4.xAxisT',
    titleKey: 'details.sec4.plot3Title',
    captionKey: 'details.sec4.plot3Caption',
  },
];

interface AnalyticalCurve {
  hj: number[];
  wh: number[];
}

function buildAnalyticalCurve(cfg: SweepConfig): AnalyticalCurve {
  const hj = new Array<number>(cfg.xAnalytical.length);
  const wh = new Array<number>(cfg.xAnalytical.length);
  for (let i = 0; i < cfg.xAnalytical.length; i++) {
    const params = cfg.paramsFor(cfg.xAnalytical[i]!);
    hj[i] = hammerstadJensen(params).z0;
    wh[i] = wheeler(params).z0;
  }
  return { hj, wh };
}

/** Per-sweep FEM marker results keyed by xFem index. */
type FemResults = Record<SweepId, Map<number, number>>;

interface QueueItem {
  sweepId: SweepId;
  idx: number;
  params: MicrostripParams;
}

/** Flat list of every FEM marker we'd like to compute, in display order. */
function buildQueue(): QueueItem[] {
  const queue: QueueItem[] = [];
  for (const cfg of SWEEPS) {
    cfg.xFem.forEach((x, idx) => {
      queue.push({ sweepId: cfg.id, idx, params: cfg.paramsFor(x) });
    });
  }
  return queue;
}

export function ComparisonSection(): React.ReactElement {
  const { t } = useTranslation();
  const [femResults, setFemResults] = useState<FemResults>(() => ({
    w: new Map(),
    eps: new Map(),
    t: new Map(),
  }));
  const [done, setDone] = useState(false);

  // Spawn the worker exactly once. It chews through the queue
  // sequentially; each completed forward solve appends a marker to
  // the relevant sweep's map. Worker is terminated on unmount.
  useEffect(() => {
    const worker = new FemWorker();
    const queue = buildQueue();
    let head = 0;
    let cancelled = false;
    let nextId = 1;

    const sendNext = (): void => {
      if (cancelled) return;
      if (head >= queue.length) {
        setDone(true);
        worker.terminate();
        return;
      }
      const item = queue[head]!;
      const req: WorkerRequest = {
        id: nextId++,
        type: 'forward',
        params: item.params,
      };
      worker.postMessage(req);
    };

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress' || msg.type === 'error') {
        if (msg.type === 'error') {
          // Skip the failing point and continue. Marker just won't appear.
          head++;
          sendNext();
        }
        return;
      }
      if (msg.type !== 'forward-result') return;
      const item = queue[head];
      if (!item) return;
      setFemResults((prev) => {
        const next: FemResults = {
          w: new Map(prev.w),
          eps: new Map(prev.eps),
          t: new Map(prev.t),
        };
        next[item.sweepId].set(item.idx, msg.fem.z0);
        return next;
      });
      head++;
      sendNext();
    };

    sendNext();

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, []);

  return (
    <div className="comparison-section">
      {SWEEPS.map((cfg) => (
        <SweepPlot
          key={cfg.id}
          cfg={cfg}
          femSamples={femResults[cfg.id]}
          done={done}
          t={t}
        />
      ))}
    </div>
  );
}

interface SweepPlotProps {
  cfg: SweepConfig;
  femSamples: Map<number, number>;
  done: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}

function SweepPlot({ cfg, femSamples, done, t }: SweepPlotProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const analytical = useMemo(() => buildAnalyticalCurve(cfg), [cfg]);

  // FEM markers — only the samples we already have.
  const femX = useMemo<number[]>(() => {
    const xs: number[] = [];
    cfg.xFem.forEach((x, idx) => {
      if (femSamples.has(idx)) xs.push(x);
    });
    return xs;
  }, [cfg, femSamples]);

  const femY = useMemo<number[]>(() => {
    const ys: number[] = [];
    cfg.xFem.forEach((_, idx) => {
      const v = femSamples.get(idx);
      if (v !== undefined) ys.push(v);
    });
    return ys;
  }, [cfg, femSamples]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void (async () => {
      const Plotly = (await loadPlotly()).default;
      if (cancelled || !ref.current) return;
      const traces: Plotly.Data[] = [
        {
          type: 'scatter',
          mode: 'lines',
          x: cfg.xAnalytical,
          y: analytical.hj,
          name: t('details.sec4.hjLine'),
          line: { color: COLOR_HJ, width: 2 },
          hovertemplate: '%{x:.3g} · %{y:.2f} Ω<extra>HJ</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: cfg.xAnalytical,
          y: analytical.wh,
          name: t('details.sec4.wheelerLine'),
          line: { color: COLOR_WHEELER, width: 2, dash: 'dash' },
          hovertemplate: '%{x:.3g} · %{y:.2f} Ω<extra>Wheeler</extra>',
        },
        {
          type: 'scatter',
          mode: 'markers',
          x: femX,
          y: femY,
          name: t('details.sec4.femMarker'),
          marker: {
            color: COLOR_FEM,
            size: 11,
            symbol: 'circle',
            line: { color: '#ffffff', width: 1.5 },
          },
          hovertemplate: '%{x:.3g} · %{y:.2f} Ω<extra>FEM</extra>',
        },
      ];
      const layout: Partial<Plotly.Layout> = {
        paper_bgcolor: PLOT_BG,
        plot_bgcolor: PLOT_BG,
        font: { color: PLOT_TEXT, family: 'Calibri, Inter, sans-serif' },
        xaxis: {
          title: { text: t(cfg.xAxisKey), font: { color: PLOT_TEXT } },
          tickfont: { color: PLOT_TEXT },
          gridcolor: PLOT_GRID,
          zerolinecolor: PLOT_GRID,
          linecolor: PLOT_GRID,
          ...(cfg.logX ? { type: 'log' } : {}),
        },
        yaxis: {
          title: { text: t('details.sec4.yAxisZ0'), font: { color: PLOT_TEXT } },
          tickfont: { color: PLOT_TEXT },
          gridcolor: PLOT_GRID,
          zerolinecolor: PLOT_GRID,
          linecolor: PLOT_GRID,
        },
        margin: { t: 16, r: 16, b: 50, l: 60 },
        showlegend: true,
        legend: {
          x: 1,
          y: 1,
          xanchor: 'right',
          yanchor: 'top',
          bgcolor: 'rgba(15, 27, 45, 0.78)',
          bordercolor: PLOT_GRID,
          borderwidth: 1,
          font: { color: PLOT_TEXT },
        },
      };
      void Plotly.react(node, traces, layout, { responsive: true, displaylogo: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [analytical, femX, femY, cfg, t]);

  const inProgress = !done && femSamples.size < cfg.xFem.length;

  return (
    <figure className="comparison-section__figure">
      <figcaption className="comparison-section__title">
        {t(cfg.titleKey)}
      </figcaption>
      <div ref={ref} className="comparison-section__canvas" />
      {inProgress && (
        <p className="comparison-section__loading">{t('details.sec4.loading')}</p>
      )}
      <p className="comparison-section__caption">{t(cfg.captionKey)}</p>
    </figure>
  );
}
