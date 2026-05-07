/**
 * Side-by-side comparison of the FEM result against the two closed-form
 * formulas (Hammerstad–Jensen and Wheeler / Pozar). Δ% is computed against
 * the FEM column, since FEM is the "rigorous" baseline of this tool.
 */

import { useTranslation } from 'react-i18next';
import type { CalcResult } from '../hooks/useMicrostripCalc';

export interface ComparisonTableProps {
  result: CalcResult | null;
}

interface Row {
  label: string;
  z0: number;
  epsilonEff: number;
  z0DeltaPct: number | null;
}

export function ComparisonTable({ result }: ComparisonTableProps): React.ReactElement {
  const { t } = useTranslation();

  if (!result) {
    return (
      <section className="comparison-table">
        <h2>{t('comparison.title')}</h2>
        <p className="hint">{t('comparison.empty')}</p>
      </section>
    );
  }

  const { fem, hammerstad, wheeler } = result;
  const rows: Row[] = [
    { label: t('comparison.fem'), z0: fem.z0, epsilonEff: fem.epsilonEff, z0DeltaPct: null },
    {
      label: t('comparison.hammerstad'),
      z0: hammerstad.z0,
      epsilonEff: hammerstad.epsilonEff,
      z0DeltaPct: ((hammerstad.z0 - fem.z0) / fem.z0) * 100,
    },
    {
      label: t('comparison.wheeler'),
      z0: wheeler.z0,
      epsilonEff: wheeler.epsilonEff,
      z0DeltaPct: ((wheeler.z0 - fem.z0) / fem.z0) * 100,
    },
  ];

  return (
    <section className="comparison-table">
      <h2>{t('comparison.title')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('comparison.method')}</th>
            <th>{t('comparison.z0')}</th>
            <th>{t('comparison.epsilonEff')}</th>
            <th>{t('comparison.delta')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
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
