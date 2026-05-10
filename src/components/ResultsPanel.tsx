/**
 * Headline numbers from the FEM solve.
 *
 * Two presentation modes:
 *  - simple   — Z₀ and ε_eff in hero typography. Optimal-W is also shown
 *               whenever it's available (e.g. after a future Find-W run);
 *               C, C₀, mesh stats, CG iterations, and the adaptive
 *               convergence table are hidden as diagnostic detail.
 *  - advanced — full breakdown: hero numbers + capacitance + mesh /
 *               solver diagnostics + adaptive convergence history.
 */

import { useTranslation } from 'react-i18next';
import { dispersionCorrection } from '../analytical/dispersion';
import type { CalcResult } from '../hooks/useMicrostripCalc';
import { type LengthUnit, formatLength, fromMm } from '../lib/units';
import type { UiMode } from './ModeToggle';
import type { AdaptivePassUpdate, ProgressStage } from '../workers/messages';

export interface ResultsPanelProps {
  mode: UiMode;
  result: CalcResult | null;
  isLoading: boolean;
  progress: ProgressStage | null;
  passPreviews: AdaptivePassUpdate[];
  /** Currently-pinned pass index, or null = follow live/final. */
  selectedPassIndex: number | null;
  onSelectPass: (index: number | null) => void;
  error: string | null;
  unit: LengthUnit;
  /** Operating frequency in GHz, used to derive λ_g / λ_0 for display. */
  frequency: number;
}

export function ResultsPanel({
  mode,
  result,
  isLoading,
  progress,
  passPreviews,
  selectedPassIndex,
  onSelectPass,
  error,
  unit,
  frequency,
}: ResultsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const latestPreview = passPreviews.length > 0 ? passPreviews[passPreviews.length - 1] : null;

  if (error) {
    return (
      <section className="results-panel results-panel--error">
        <h2>{t('results.title')}</h2>
        <p className="error">{t('results.errorPrefix', { message: error })}</p>
      </section>
    );
  }

  const baseLoadingLabel = progress ? t(`results.progress.${progress}`) : t('results.loading');
  const loadingLabel =
    progress === 'adaptive-pass' && latestPreview
      ? t('results.progress.adaptive-pass-detail', {
          pass: latestPreview.pass + 1,
          triangles: latestPreview.triangleCount.toLocaleString(),
          z0: latestPreview.z0.toFixed(3),
        })
      : baseLoadingLabel;

  // Pre-build the convergence table — used both during loading (live) and
  // after completion (historical). `historyRows` falls back to passPreviews
  // while `result.fem.passes` doesn't exist yet.
  const historyRows = result?.fem.passes ?? passPreviews;
  // When `selectedPassIndex` is null we're "following the live/final"
  // result — that is, the most recent pass. Surfacing it as an explicit
  // highlight in the table makes the connection obvious: the orange
  // "Viewing" pill on the last row says "this is what the heatmap shows".
  const effectiveSelectedIndex =
    selectedPassIndex !== null ? selectedPassIndex : historyRows.length - 1;
  const convergenceTable = mode === 'advanced' && historyRows.length > 0 && (
    <details className="results-panel__adaptive" open={historyRows.length > 1}>
      <summary>{t('results.adaptive.title', { passes: historyRows.length })}</summary>
      <table className="results-panel__adaptive-table">
        <thead>
          <tr>
            <th>{t('results.adaptive.pass')}</th>
            <th>{t('results.adaptive.triangles')}</th>
            <th>{t('results.adaptive.z0')}</th>
            <th>{t('results.adaptive.deltaZ0')}</th>
            <th aria-label={t('results.adaptive.view')} />
          </tr>
        </thead>
        <tbody>
          {historyRows.map((p, i) => {
            const canView = i < passPreviews.length;
            const isSelected = effectiveSelectedIndex === i;
            return (
              <tr key={p.pass} className={isSelected ? 'is-selected' : undefined}>
                <td>{p.pass + 1}</td>
                <td>{p.triangleCount.toLocaleString()}</td>
                <td>{p.z0.toFixed(3)}</td>
                <td>{Number.isNaN(p.deltaZ0) ? '—' : p.deltaZ0.toFixed(4)}</td>
                <td>
                  <button
                    type="button"
                    className={`results-panel__view-btn${
                      isSelected ? ' results-panel__view-btn--active' : ''
                    }`}
                    disabled={!canView}
                    onClick={() => onSelectPass(isSelected ? null : i)}
                    title={t('results.adaptive.viewTooltip')}
                  >
                    {isSelected ? t('results.adaptive.viewing') : t('results.adaptive.view')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result?.fem.stopReason && (
        <p
          className={`results-panel__stop-reason results-panel__stop-reason--${
            result.fem.stopReason === 'converged' ? 'ok' : 'warn'
          }`}
        >
          {t(`results.adaptive.stopReason.${result.fem.stopReason}`)}
        </p>
      )}
      {selectedPassIndex !== null && (
        <button
          type="button"
          className="results-panel__view-reset"
          onClick={() => onSelectPass(null)}
        >
          {t('results.adaptive.reset')}
        </button>
      )}
    </details>
  );

  if (isLoading && !result) {
    return (
      <section className="results-panel">
        <h2>{t('results.title')}</h2>
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          {loadingLabel}
        </p>
        {convergenceTable}
      </section>
    );
  }

  if (!result) {
    return (
      <section className="results-panel">
        <h2>{t('results.title')}</h2>
        <p className="hint">{t('results.empty')}</p>
      </section>
    );
  }

  const { fem, optimalW, targetBand, paramsUsed } = result;

  // Apply Kirschning-Jansen dispersion correction on top of the FEM
  // quasi-static solve. The hero numbers below are the f-dependent values
  // (what designers care about); the static FEM values are surfaced in
  // the Advanced detail block so the user can see what the rigorous static
  // solver produced before the closed-form correction.
  const { epsilonEffF, z0Ratio } = dispersionCorrection({
    epsilonR: paramsUsed.epsilonR,
    epsilonEffStatic: fem.epsilonEff,
    widthMm: paramsUsed.width,
    heightMm: paramsUsed.height,
    frequencyGHz: frequency,
  });
  const z0F = fem.z0 * z0Ratio;
  const dispersionDeltaZ0 = z0F - fem.z0;

  return (
    <section className={`results-panel${isLoading ? ' results-panel--reloading' : ''}`}>
      <h2>{t('results.title')}</h2>
      {isLoading && <p className="loading">{loadingLabel}</p>}

      <div
        className={`results-panel__hero${
          optimalW !== undefined ? ' results-panel__hero--three' : ''
        }`}
      >
        <div className="result-hero">
          <span className="result-hero__label">{t('results.z0')}</span>
          <span className="result-hero__value">
            <span className="result-hero__number">{z0F.toFixed(2)}</span>
            <span className="result-hero__unit">Ω</span>
          </span>
        </div>
        {/* W hero is meaningful only after Find-W (inverse search), where
            the bisection result is the headline. In forward mode the user
            already typed W, so showing it back as a hero is redundant. */}
        {optimalW !== undefined && (
          <div className="result-hero result-hero--tertiary">
            <span className="result-hero__label">{t('results.heroW')}</span>
            <span className="result-hero__value">
              <span className="result-hero__number">
                {fromMm(optimalW, unit).toFixed(3)}
              </span>
              <span className="result-hero__unit">{unit}</span>
            </span>
          </div>
        )}
        <div className="result-hero result-hero--secondary">
          <span className="result-hero__label">{t('results.epsilonEff')}</span>
          <span className="result-hero__value">
            <span className="result-hero__number">{epsilonEffF.toFixed(3)}</span>
          </span>
        </div>
      </div>

      {(optimalW !== undefined || targetBand) && (
        <dl className="results-panel__numbers">
          {optimalW !== undefined && (
            <>
              <dt>{t('results.optimalW')}</dt>
              <dd>{formatLength(optimalW, unit)}</dd>
            </>
          )}
          {targetBand && (
            <>
              <dt>{t('results.targetBandLabel')}</dt>
              <dd>
                {t('results.targetBandValue', {
                  low: targetBand.low.toFixed(3),
                  high: targetBand.high.toFixed(3),
                  target: targetBand.targetZ0,
                  pct: (targetBand.pct * 100).toFixed(2),
                })}
              </dd>
            </>
          )}
        </dl>
      )}

      {mode === 'advanced' && (
        <>
          <dl className="results-panel__numbers">
            <dt>{t('results.solvedAt')}</dt>
            <dd>{formatLength(paramsUsed.width, unit)}</dd>

            <dt>{t('results.z0Static')}</dt>
            <dd>{fem.z0.toFixed(3)} Ω</dd>

            <dt>{t('results.epsilonEffStatic')}</dt>
            <dd>{fem.epsilonEff.toFixed(3)}</dd>

            <dt>{t('results.dispersionDelta')}</dt>
            <dd>
              {dispersionDeltaZ0 >= 0 ? '+' : ''}
              {dispersionDeltaZ0.toFixed(3)} Ω
            </dd>

            <dt>{t('results.capacitance')}</dt>
            <dd>{(fem.c * 1e12).toFixed(3)} pF/m</dd>

            <dt>{t('results.vacuumCapacitance')}</dt>
            <dd>{(fem.c0 * 1e12).toFixed(3)} pF/m</dd>
          </dl>

          <p className="results-panel__diagnostics">
            {t('results.diagnostics', {
              triangles: fem.triangleCount.toLocaleString(),
              withDielectric: fem.cgIterations.withDielectric,
              vacuum: fem.cgIterations.vacuum,
            })}
          </p>
        </>
      )}

      {convergenceTable}
    </section>
  );
}
