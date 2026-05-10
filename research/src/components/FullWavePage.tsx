/**
 * Full-wave PML calculator — shelved experimental sister of the main
 * KJ + quasi-static page.
 *
 * Lives under `research/` since v0.2 shelved the experimental link in
 * the production UI (results didn't match the reference well enough to
 * ship). The math pipeline under `research/src/fem-fullwave/` and the
 * numerical regression tests in `research/tests/` are intact; this
 * component is kept so resuming development is "wire this back up to
 * App.tsx + add a header button" rather than "reconstruct the page
 * from scratch". See `research/README.md` for the resume checklist.
 *
 * Strings are hard-coded English here (rather than pulling from
 * `src/i18n/`) because the production locales no longer carry the
 * `fullwave.*` keys — keeping research self-contained means the page
 * type-checks and the smoke test runs in isolation.
 */

import { useState } from 'react';
import { useFullWaveCalc } from '../hooks/useFullWaveCalc';
import { NumberField } from '../../../src/components/NumberField';
import type { MicrostripParams } from '../../../src/types';

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
          ← Back to calculator
        </button>
        <h1 className="fullwave-page__title">Full-wave (experimental)</h1>
      </header>

      <div className="fullwave-page__disclaimer">
        <strong>Experimental — not for production use</strong>
        <p>
          This page runs the new vector-Helmholtz FEM with SC-PML truncation.
          The math pipeline is validated end-to-end (ε_eff matches KJ within
          0.3 % on the test mesh), but the Jacobi-PCG inner solver stagnates
          below ~20 GHz and the V-P Z₀ extraction on the coarse mesh sits ~30
          % off the KJ reference. The main calculator (KJ post-process)
          remains the trusted production path.
        </p>
      </div>

      <form className="fullwave-page__form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>Microstrip parameters</legend>
          <NumberField
            id="fw-W"
            label="Trace width W [mm]"
            value={params.width}
            min={0}
            step={0.01}
            onChange={(v) => setParams((p) => ({ ...p, width: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-h"
            label="Substrate height h [mm]"
            value={params.height}
            min={0}
            step={0.01}
            onChange={(v) => setParams((p) => ({ ...p, height: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-t"
            label="Conductor thickness t [mm]"
            value={params.thickness}
            min={0}
            step={0.001}
            onChange={(v) => setParams((p) => ({ ...p, thickness: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-eps"
            label="Relative permittivity εr"
            value={params.epsilonR}
            min={1}
            step={0.1}
            onChange={(v) => setParams((p) => ({ ...p, epsilonR: v }))}
            disabled={isLoading}
          />
          <NumberField
            id="fw-f"
            label="Frequency [GHz, ≥ 20]"
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
          {isLoading ? 'Solving…' : 'Run full-wave solve'}
        </button>
        {frequency < 20 && (
          <p className="fullwave-page__warn">
            Inner BiCGStab stagnates below ~20 GHz on the current mesh. Bump
            frequency to 20 GHz or higher.
          </p>
        )}
      </form>

      {error && <p className="fullwave-page__error">{error}</p>}

      {result && (
        <section className="fullwave-page__results">
          <h2>Results</h2>
          <table className="fullwave-page__table">
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Full-wave (FEM)</th>
                <th>KJ (reference)</th>
                <th>Δ</th>
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
            <summary>Solver diagnostics</summary>
            <ul>
              <li>Outer iterations: {result.outerIterations}</li>
              <li>
                Inner iterations (BiCGStab, total): {result.innerIterations}
              </li>
              <li>Wall time: {(result.elapsedMs / 1000).toFixed(2)} s</li>
              <li>Converged: {result.converged ? 'yes' : 'no'}</li>
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
