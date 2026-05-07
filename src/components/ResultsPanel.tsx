/**
 * Headline numbers from the FEM solve: Z₀, ε_eff, optimal W (when the user
 * triggered a bisection), and a small mesh-quality footer.
 */

import { useTranslation } from 'react-i18next';
import type { CalcResult } from '../hooks/useMicrostripCalc';
import { type LengthUnit, formatLength } from '../lib/units';
import type { ProgressStage } from '../workers/messages';

export interface ResultsPanelProps {
  result: CalcResult | null;
  isLoading: boolean;
  progress: ProgressStage | null;
  error: string | null;
  unit: LengthUnit;
}

export function ResultsPanel({
  result,
  isLoading,
  progress,
  error,
  unit,
}: ResultsPanelProps): React.ReactElement {
  const { t } = useTranslation();

  if (error) {
    return (
      <section className="results-panel results-panel--error">
        <h2>{t('results.title')}</h2>
        <p className="error">{t('results.errorPrefix', { message: error })}</p>
      </section>
    );
  }

  const loadingLabel = progress ? t(`results.progress.${progress}`) : t('results.loading');

  if (isLoading && !result) {
    return (
      <section className="results-panel">
        <h2>{t('results.title')}</h2>
        <p className="loading">{loadingLabel}</p>
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

  const { fem, optimalW, paramsUsed } = result;

  return (
    <section className={`results-panel${isLoading ? ' results-panel--reloading' : ''}`}>
      <h2>{t('results.title')}</h2>
      {isLoading && <p className="loading">{loadingLabel}</p>}
      <dl className="results-panel__numbers">
        <dt>{t('results.z0')}</dt>
        <dd>{fem.z0.toFixed(3)} Ω</dd>

        <dt>{t('results.epsilonEff')}</dt>
        <dd>{fem.epsilonEff.toFixed(3)}</dd>

        <dt>{t('results.solvedAt')}</dt>
        <dd>{formatLength(paramsUsed.width, unit)}</dd>

        {optimalW !== undefined && (
          <>
            <dt>{t('results.optimalW')}</dt>
            <dd>{formatLength(optimalW, unit)}</dd>
          </>
        )}

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
    </section>
  );
}
