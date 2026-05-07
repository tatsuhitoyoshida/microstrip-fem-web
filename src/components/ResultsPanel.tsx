/**
 * Headline numbers from the FEM solve: Z₀, ε_eff, optimal W (when the user
 * triggered a bisection), and a small mesh-quality footer.
 */

import type { CalcResult } from '../hooks/useMicrostripCalc';
import { type LengthUnit, formatLength } from '../lib/units';

export interface ResultsPanelProps {
  result: CalcResult | null;
  isLoading: boolean;
  error: string | null;
  unit: LengthUnit;
}

export function ResultsPanel({
  result,
  isLoading,
  error,
  unit,
}: ResultsPanelProps): React.ReactElement {
  if (error) {
    return (
      <section className="results-panel results-panel--error">
        <h2>Results</h2>
        <p className="error">Error: {error}</p>
      </section>
    );
  }

  if (isLoading && !result) {
    return (
      <section className="results-panel">
        <h2>Results</h2>
        <p className="loading">Solving FEM…</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="results-panel">
        <h2>Results</h2>
        <p className="hint">Set parameters and press Calculate.</p>
      </section>
    );
  }

  const { fem, optimalW, paramsUsed } = result;

  return (
    <section className={`results-panel${isLoading ? ' results-panel--reloading' : ''}`}>
      <h2>Results</h2>
      <dl className="results-panel__numbers">
        <dt>Z₀</dt>
        <dd>{fem.z0.toFixed(3)} Ω</dd>

        <dt>ε_eff</dt>
        <dd>{fem.epsilonEff.toFixed(3)}</dd>

        <dt>Solved at W</dt>
        <dd>{formatLength(paramsUsed.width, unit)}</dd>

        {optimalW !== undefined && (
          <>
            <dt>Optimal W (bisection)</dt>
            <dd>{formatLength(optimalW, unit)}</dd>
          </>
        )}

        <dt>C</dt>
        <dd>{(fem.c * 1e12).toFixed(3)} pF/m</dd>

        <dt>C₀ (vacuum)</dt>
        <dd>{(fem.c0 * 1e12).toFixed(3)} pF/m</dd>
      </dl>

      <p className="results-panel__diagnostics">
        Mesh: {fem.triangleCount.toLocaleString()} triangles · CG iterations:{' '}
        {fem.cgIterations.withDielectric} (dielectric) / {fem.cgIterations.vacuum} (vacuum)
      </p>
    </section>
  );
}
