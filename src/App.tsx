import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CrossSectionPlot } from './components/CrossSectionPlot';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { ModeToggle, type UiMode } from './components/ModeToggle';
import { type AdaptiveSettings, ParameterForm } from './components/ParameterForm';
import { ResultsPanel } from './components/ResultsPanel';
import { SweepChart } from './components/SweepChart';
import { WhatIsThis } from './components/WhatIsThis';
import type { MicrostripSolveOptions } from './fem/tlanalysis';
import type { CalcResult } from './hooks/useMicrostripCalc';
import { useMicrostripCalc } from './hooks/useMicrostripCalc';
import type { LengthUnit } from './lib/units';
import type { MicrostripParams } from './types';
import type { AdaptivePassUpdate } from './workers/messages';
import './App.css';

const MODE_STORAGE_KEY = 'microstrip-fem.ui-mode';

function loadInitialMode(): UiMode {
  if (typeof window === 'undefined') return 'simple';
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'advanced' ? 'advanced' : 'simple';
}

function buildSolveOptions(adaptive: AdaptiveSettings): MicrostripSolveOptions | undefined {
  if (!adaptive.enabled) return undefined;
  return {
    adaptive: { tolerance: adaptive.tolerance, maxPasses: adaptive.maxPasses },
  };
}

/**
 * Synthesise a CalcResult-shaped object from a streamed pass snapshot so
 * `CrossSectionPlot` can render the live or historical mesh without
 * inventing a new component-side type. `paramsUsed`, `hammerstad`, `wheeler`
 * are reused from the most recent baseline (final result if available, else
 * the first preview).
 */
function previewToCalcResult(
  preview: AdaptivePassUpdate,
  paramsUsed: MicrostripParams,
  baseline: CalcResult | null,
): CalcResult {
  const triangleCount = preview.triangles.length / 3;
  return {
    fem: {
      z0: preview.z0,
      epsilonEff: preview.epsilonEff,
      c: baseline?.fem.c ?? 0,
      c0: baseline?.fem.c0 ?? 0,
      triangleCount,
      cgIterations: { withDielectric: 0, vacuum: 0 },
      mesh: {
        vertices: preview.vertices,
        triangles: preview.triangles,
        triangleAttributes: new Float64Array(triangleCount),
        vertexMarkers: new Int32Array(preview.vertices.length / 2),
        neighborList: new Int32Array(0),
        minAngleDeg: 0,
        triangleCount,
      },
      phi: preview.phi,
      phiVacuum: preview.phi,
      bounds: preview.bounds,
    },
    hammerstad: baseline?.hammerstad ?? { z0: 0, epsilonEff: 0 },
    wheeler: baseline?.wheeler ?? { z0: 0, epsilonEff: 0 },
    paramsUsed,
    ...(baseline?.optimalW !== undefined ? { optimalW: baseline.optimalW } : {}),
  };
}

function App(): React.ReactElement {
  const { t } = useTranslation();
  const { result, isLoading, progress, passPreviews, error, computeForward, findOptimalW } =
    useMicrostripCalc();
  const [mode, setMode] = useState<UiMode>(() => loadInitialMode());
  /**
   * Operating frequency in GHz. Lives in App so it can be threaded into
   * ResultsPanel for λ_g / λ_0 post-processing — the FEM solver doesn't
   * use it (quasi-static), so it stays out of MicrostripParams.
   */
  const [frequency, setFrequency] = useState(1.0);
  // The form is the source of truth for the display unit; we only need it
  // here for the panels that render derived lengths.
  const [unit] = useState<LengthUnit>('mm');
  /** null = "follow the live/final result"; index = pinned to that pass. */
  const [selectedPassIndex, setSelectedPassIndex] = useState<number | null>(null);
  const [lastParams, setLastParams] = useState<MicrostripParams | null>(null);

  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const displayResult = useMemo<CalcResult | null>(() => {
    // Pinned pass takes priority — even after the run finished.
    if (selectedPassIndex !== null && passPreviews[selectedPassIndex] && lastParams) {
      return previewToCalcResult(passPreviews[selectedPassIndex], lastParams, result);
    }
    // Live preview during loading: show the latest pass that has streamed in.
    if (isLoading && passPreviews.length > 0 && lastParams) {
      return previewToCalcResult(
        passPreviews[passPreviews.length - 1]!,
        lastParams,
        result,
      );
    }
    return result;
  }, [selectedPassIndex, passPreviews, result, isLoading, lastParams]);

  return (
    <div className={`app app--${mode}`}>
      <header className="app__header">
        <a
          className="app__brand-link"
          href="https://www.photonic-edge.com/"
          target="_blank"
          rel="noreferrer"
          aria-label={t('app.brand')}
        >
          <img className="app__logo" src="/logo-wordmark.png" alt={t('app.brand')} />
        </a>
        <p className="app__title">{t('app.title')}</p>
        <div className="app__header-controls">
          <ModeToggle value={mode} onChange={setMode} />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="app__content">
        <h1 className="app__tool-name">
          {t('app.toolNameMain')}
          <span className="app__tool-name__suffix"> {t('app.toolNameSuffix')}</span>
        </h1>
        <WhatIsThis />

        <main className="app__main">
        <aside className="app__form">
          <ParameterForm
            mode={mode}
            isLoading={isLoading}
            frequency={frequency}
            onFrequencyChange={setFrequency}
            onCalculate={(p, adaptive) => {
              setSelectedPassIndex(null);
              setLastParams(p);
              void computeForward(p, buildSolveOptions(adaptive));
            }}
            onFindOptimalW={(target, fixed, adaptive, tolerancePct, frequencyGHz) => {
              // Width is unknown until the bisection finishes; use the
              // existing default so the synthesised live preview at least
              // has *some* paramsUsed value. The final `result` will
              // overwrite this with the recovered W.
              setSelectedPassIndex(null);
              setLastParams({ ...fixed, width: 0 });
              // UI feeds % (e.g. 1.0); the hook expects a fraction.
              // `frequencyGHz` lifts the bisection target from static Z₀_qs
              // to the KJ-dispersion-corrected Z₀(f) — so the recovered W
              // makes the displayed Z₀ hero match the user-set target.
              void findOptimalW(
                target,
                fixed,
                buildSolveOptions(adaptive),
                tolerancePct / 100,
                frequencyGHz,
              );
            }}
          />
        </aside>

        <section className="app__viz">
          <CrossSectionPlot result={displayResult} isLoading={isLoading} />
          <ResultsPanel
            mode={mode}
            result={result}
            isLoading={isLoading}
            progress={progress}
            passPreviews={passPreviews}
            selectedPassIndex={selectedPassIndex}
            onSelectPass={setSelectedPassIndex}
            error={error}
            unit={unit}
            frequency={frequency}
          />
          {mode === 'advanced' && <SweepChart result={result} />}
        </section>
        </main>
      </div>

      <footer className="app__footer">
        <span>{t('app.footer')}</span>
      </footer>
    </div>
  );
}

export default App;
