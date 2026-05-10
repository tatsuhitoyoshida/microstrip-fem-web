/**
 * Z₀ frequency-response chart for the Advanced view.
 *
 * Three traces share the same Kirschning-Jansen dispersion correction;
 * what differs is the static-Z₀ / static-ε_eff seed each one is built on:
 *   - FEM (rigorous in-browser 2D solve) — drawn thick in brand magenta
 *   - Hammerstad-Jensen (closed-form) — thin overlay
 *   - Wheeler / Pozar (closed-form)    — thin overlay
 *
 * The chart lets the designer eyeball where the FEM curve diverges from
 * closed-form approximations as f rises (i.e. how much the rigorous
 * static seed matters for dispersion-corrected predictions).
 *
 * Plotly is loaded lazily so it doesn't bloat the initial bundle. The
 * loader pattern matches `CrossSectionPlot` — ES module caching means
 * both promises end up resolving to the same network fetch.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Plotly from 'plotly.js';
import { dispersionCorrection } from '../analytical/dispersion';
import type { CalcResult } from '../hooks/useMicrostripCalc';

type PlotlyModule = typeof import('plotly.js-dist-min');
let plotlyModulePromise: Promise<PlotlyModule> | null = null;
function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyModulePromise) plotlyModulePromise = import('plotly.js-dist-min');
  return plotlyModulePromise;
}

const N_POINTS = 100;
const DEFAULT_START_GHZ = 0.1;
const DEFAULT_STOP_GHZ = 50;

const COLOR_FEM = '#e91e8c'; // brand magenta
const COLOR_HJ = '#ed7d31'; // accent warm
const COLOR_WHEELER = '#9ba8bd'; // muted gray-blue
const PLOT_BG = '#162639';
const PLOT_TEXT = '#e7e6e6';
const PLOT_GRID = '#2c3e5a';

export interface SweepChartProps {
  result: CalcResult | null;
}

interface SweepData {
  freqs: number[];
  z0Fem: number[];
  z0Hj: number[];
  z0Wheeler: number[];
}

function logspace(start: number, stop: number, n: number): number[] {
  const a = Math.log10(Math.max(start, 1e-6));
  const b = Math.log10(Math.max(stop, start * 1.000001));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i] = Math.pow(10, a + (b - a) * t);
  }
  return out;
}

function computeSweep(result: CalcResult, startGHz: number, stopGHz: number): SweepData {
  const freqs = logspace(startGHz, stopGHz, N_POINTS);
  const z0Fem = new Array<number>(N_POINTS);
  const z0Hj = new Array<number>(N_POINTS);
  const z0Wheeler = new Array<number>(N_POINTS);
  const { width, height, epsilonR } = result.paramsUsed;
  for (let i = 0; i < N_POINTS; i++) {
    const f = freqs[i]!;
    z0Fem[i] =
      result.fem.z0 *
      dispersionCorrection({
        epsilonR,
        epsilonEffStatic: result.fem.epsilonEff,
        widthMm: width,
        heightMm: height,
        frequencyGHz: f,
      }).z0Ratio;
    z0Hj[i] =
      result.hammerstad.z0 *
      dispersionCorrection({
        epsilonR,
        epsilonEffStatic: result.hammerstad.epsilonEff,
        widthMm: width,
        heightMm: height,
        frequencyGHz: f,
      }).z0Ratio;
    z0Wheeler[i] =
      result.wheeler.z0 *
      dispersionCorrection({
        epsilonR,
        epsilonEffStatic: result.wheeler.epsilonEff,
        widthMm: width,
        heightMm: height,
        frequencyGHz: f,
      }).z0Ratio;
  }
  return { freqs, z0Fem, z0Hj, z0Wheeler };
}

export function SweepChart({ result }: SweepChartProps): React.ReactElement {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [startGHz, setStartGHz] = useState(DEFAULT_START_GHZ);
  const [stopGHz, setStopGHz] = useState(DEFAULT_STOP_GHZ);

  const rangeValid = startGHz > 0 && stopGHz > startGHz;

  const sweep = useMemo<SweepData | null>(() => {
    if (!result || !rangeValid) return null;
    return computeSweep(result, startGHz, stopGHz);
  }, [result, startGHz, stopGHz, rangeValid]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    void (async () => {
      const Plotly = (await loadPlotly()).default;
      if (cancelled || !ref.current) return;
      if (!sweep) {
        Plotly.purge(node);
        return;
      }
      const traces: Plotly.Data[] = [
        {
          type: 'scatter',
          mode: 'lines',
          x: sweep.freqs,
          y: sweep.z0Hj,
          name: `[ref] ${t('comparison.hammerstad')}`,
          line: { color: COLOR_HJ, width: 2, dash: 'dash' },
          hovertemplate: '%{x:.3g} GHz · %{y:.3f} Ω<extra>HJ</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: sweep.freqs,
          y: sweep.z0Wheeler,
          name: `[ref] ${t('comparison.wheeler')}`,
          line: { color: COLOR_WHEELER, width: 2, dash: 'dash' },
          hovertemplate: '%{x:.3g} GHz · %{y:.3f} Ω<extra>Wheeler</extra>',
        },
        {
          // FEM last so it draws on top of the reference curves.
          type: 'scatter',
          mode: 'lines',
          x: sweep.freqs,
          y: sweep.z0Fem,
          name: t('comparison.fem'),
          line: { color: COLOR_FEM, width: 3 },
          hovertemplate: '%{x:.3g} GHz · %{y:.3f} Ω<extra>FEM</extra>',
        },
      ];
      const layout: Partial<Plotly.Layout> = {
        paper_bgcolor: PLOT_BG,
        plot_bgcolor: PLOT_BG,
        font: { color: PLOT_TEXT, family: 'Calibri, Inter, sans-serif' },
        xaxis: {
          title: { text: t('sweep.xAxis'), font: { color: PLOT_TEXT } },
          tickfont: { color: PLOT_TEXT },
          gridcolor: PLOT_GRID,
          zerolinecolor: PLOT_GRID,
          linecolor: PLOT_GRID,
          type: 'log',
        },
        yaxis: {
          title: { text: t('sweep.yAxis'), font: { color: PLOT_TEXT } },
          tickfont: { color: PLOT_TEXT },
          gridcolor: PLOT_GRID,
          zerolinecolor: PLOT_GRID,
          linecolor: PLOT_GRID,
        },
        margin: { t: 20, r: 20, b: 50, l: 60 },
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
  }, [sweep, t]);

  return (
    <section className="sweep-chart">
      <h2>{t('sweep.title')}</h2>
      <div className="sweep-chart__controls">
        <div className="number-field">
          <label htmlFor="sweep-start">{t('sweep.startGHz')}</label>
          <input
            id="sweep-start"
            type="number"
            min={1e-3}
            step={0.1}
            value={startGHz}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next > 0) setStartGHz(next);
            }}
          />
        </div>
        <div className="number-field">
          <label htmlFor="sweep-stop">{t('sweep.stopGHz')}</label>
          <input
            id="sweep-stop"
            type="number"
            min={1e-3}
            step={1}
            value={stopGHz}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next > 0) setStopGHz(next);
            }}
          />
        </div>
      </div>
      <div ref={ref} className="sweep-chart__canvas" />
      {!result && <p className="hint sweep-chart__hint">{t('sweep.empty')}</p>}
      <p className="sweep-chart__note">{t('sweep.note')}</p>
    </section>
  );
}
