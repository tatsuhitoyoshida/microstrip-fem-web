/**
 * Full-wave PML calculator — experimental sister of the main
 * quasi-static + KJ page.
 *
 * Mounted under a separate top-level tab so the main calculator
 * stays untouched (and trusted: 1 % vs reference). This page runs
 * the new vector-Helmholtz Nédélec FEM with SC-PML truncation
 * (`src/fem-fullwave/`). What's surfaced:
 *
 *   - β² (complex) — propagation constant squared
 *   - ε_eff(f) = β²/k₀² — real part is the standard dispersion
 *     number; imag part is radiation / PML absorption
 *   - Z₀ via the Voltage-Power definition
 *   - KJ-dispersive ε_eff(f) and Z₀(f) side-by-side as a
 *     trustworthy reference
 *   - Diagnostics (outer / inner iteration counts, wall time,
 *     convergence flag)
 *
 * The disclaimer at the top is load-bearing — the underlying
 * Jacobi-PCG inner solver stalls below ~20 GHz and the V-P
 * extraction is ~30 % off on the coarse mesh we use to keep the
 * worker responsive. See `docs/validation.md` for the full picture.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFullWaveCalc } from '../hooks/useFullWaveCalc';
import { NumberField } from './NumberField';
import type { MicrostripParams } from '../types';

const FR4_DEFAULT: MicrostripParams = {
  width: 3.0,
  height: 1.6,
  thickness: 0.035,
  epsilonR: 4.4,
};

export interface FullWavePageProps {
  onBack: () => void;
}

export function FullWavePage(props: FullWavePageProps): React.ReactElement {
  const { t } = useTranslation();
  const { result, isLoading, error, compute } = useFullWaveCalc();
  const [params, setParams] = useState<MicrostripParams>(FR4_DEFAULT);
  const [frequency, setFrequency] = useState(20);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void compute(params, frequency);
  };

  return (
    <div className="fullwave-page">
      <header className="fullwave-page__header">
        <button
          type="button"
          className="fullwave-page__back"
          onClick={props.onBack}
        >
          ← {t('fullwave.back')}
        </button>
        <h1 className="fullwave-page__title">{t('fullwave.title')}</h1>
      </header>

      <div className="fullwave-page__disclaimer">
        <strong>{t('fullwave.disclaimerTitle')}</strong>
        <p>{t('fullwave.disclaimerBody')}</p>
      </div>

      <form className="fullwave-page__form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>{t('fullwave.params')}</legend>
          <NumberField
            id="fw-W"
            label={t('form.width', { unit: 'mm' })}
            value={params.width}
            min={0}
            step={0.01}
            onChange={(v) => setParams((p) => ({ ...p, width: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-h"
            label={t('form.height', { unit: 'mm' })}
            value={params.height}
            min={0}
            step={0.01}
            onChange={(v) => setParams((p) => ({ ...p, height: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-t"
            label={t('form.thickness', { unit: 'mm' })}
            value={params.thickness}
            min={0}
            step={0.001}
            onChange={(v) => setParams((p) => ({ ...p, thickness: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-eps"
            label={t('form.epsilonR')}
            value={params.epsilonR}
            min={1}
            step={0.1}
            onChange={(v) => setParams((p) => ({ ...p, epsilonR: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-f"
            label={t('fullwave.frequencyLabel')}
            value={frequency}
            min={20}
            step={1}
            onChange={setFrequency}
            disabled={isLoading}
          />
        </fieldset>

        <button
          type="submit"
          className="fullwave-page__run"
          disabled={isLoading || frequency < 20}
        >
          {isLoading ? t('fullwave.running') : t('fullwave.run')}
        </button>
        {frequency < 20 && (
          <p className="fullwave-page__warn">
            {t('fullwave.lowFreqWarn')}
          </p>
        )}
      </form>

      {error && <p className="fullwave-page__error">{error}</p>}

      {result && (
        <section className="fullwave-page__results">
          <h2>{t('fullwave.resultsTitle')}</h2>
          <table className="fullwave-page__table">
            <thead>
              <tr>
                <th>{t('fullwave.col.quantity')}</th>
                <th>{t('fullwave.col.fullwave')}</th>
                <th>{t('fullwave.col.kjref')}</th>
                <th>{t('fullwave.col.delta')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ε_eff(f)</td>
                <td>{result.epsilonEff.re.toFixed(3)}</td>
                <td>{result.kjReferenceEpsEff.toFixed(3)}</td>
                <td>
                  {(
                    ((result.epsilonEff.re - result.kjReferenceEpsEff) /
                      result.kjReferenceEpsEff) *
                    100
                  ).toFixed(2)}{' '}
                  %
                </td>
              </tr>
              <tr>
                <td>Z₀ [Ω]</td>
                <td>{result.z0.toFixed(2)}</td>
                <td>{result.kjReferenceZ0.toFixed(2)}</td>
                <td>
                  {(
                    ((result.z0 - result.kjReferenceZ0) /
                      result.kjReferenceZ0) *
                    100
                  ).toFixed(2)}{' '}
                  %
                </td>
              </tr>
              <tr>
                <td>β² [1/mm²]</td>
                <td colSpan={3}>
                  {result.beta2.re.toExponential(3)} +{' '}
                  {result.beta2.im.toExponential(3)} j
                </td>
              </tr>
            </tbody>
          </table>

          <details className="fullwave-page__diagnostics">
            <summary>{t('fullwave.diagnostics')}</summary>
            <ul>
              <li>
                {t('fullwave.diag.outer')}: {result.outerIterations}
              </li>
              <li>
                {t('fullwave.diag.inner')}: {result.innerIterations}
              </li>
              <li>
                {t('fullwave.diag.elapsed')}:{' '}
                {(result.elapsedMs / 1000).toFixed(2)} s
              </li>
              <li>
                {t('fullwave.diag.converged')}:{' '}
                {result.converged ? 'yes' : 'no'}
              </li>
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
