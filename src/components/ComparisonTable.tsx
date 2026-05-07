/**
 * Side-by-side comparison of the FEM result against the two closed-form
 * formulas (Hammerstad–Jensen and Wheeler / Pozar). Δ% is computed against
 * the FEM column, since FEM is the "rigorous" baseline of this tool.
 */

import type { CalcResult } from '../hooks/useMicrostripCalc';

export interface ComparisonTableProps {
  result: CalcResult | null;
}

interface Row {
  method: string;
  z0: number;
  epsilonEff: number;
  z0DeltaPct: number | null;
}

export function ComparisonTable({ result }: ComparisonTableProps): React.ReactElement {
  if (!result) {
    return (
      <section className="comparison-table">
        <h2>Comparison</h2>
        <p className="hint">No results yet.</p>
      </section>
    );
  }

  const { fem, hammerstad, wheeler } = result;
  const rows: Row[] = [
    { method: 'FEM', z0: fem.z0, epsilonEff: fem.epsilonEff, z0DeltaPct: null },
    {
      method: 'Hammerstad–Jensen',
      z0: hammerstad.z0,
      epsilonEff: hammerstad.epsilonEff,
      z0DeltaPct: ((hammerstad.z0 - fem.z0) / fem.z0) * 100,
    },
    {
      method: 'Wheeler / Pozar',
      z0: wheeler.z0,
      epsilonEff: wheeler.epsilonEff,
      z0DeltaPct: ((wheeler.z0 - fem.z0) / fem.z0) * 100,
    },
  ];

  return (
    <section className="comparison-table">
      <h2>Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Z₀ [Ω]</th>
            <th>ε_eff</th>
            <th>Δ Z₀ vs FEM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method}>
              <td>{r.method}</td>
              <td className="numeric">{r.z0.toFixed(3)}</td>
              <td className="numeric">{r.epsilonEff.toFixed(3)}</td>
              <td className="numeric">
                {r.z0DeltaPct === null
                  ? '—'
                  : `${r.z0DeltaPct >= 0 ? '+' : ''}${r.z0DeltaPct.toFixed(2)} %`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
