/**
 * User-facing explainer page reached from the WhatIsThis banner's
 * "more details" link.
 *
 * This is **not** developer documentation — that lives in `docs/`. Here
 * the audience is a PCB / RF designer who wants to understand why this
 * calculator's numbers should be trusted relative to the Hammerstad-
 * Jensen / Wheeler closed forms most other web calculators use. We
 * walk through the conventional formulas first (with their fitting
 * envelope and silent failure modes), then sketch the 2-D FEM the
 * tool runs in the browser, then close with a short note on the mesh
 * and computational shortcuts, an analytical comparison gallery, and
 * a usage guide for Simple / Advanced.
 *
 * All long-form prose is i18next-keyed so the page renders correctly
 * on the `/en/` and `/ja/` locales. Reference titles + author names
 * stay in their authoritative English form on both locales (citing
 * IEEE-format papers in a translated form is non-standard and breaks
 * searchability); only the section heading "References / 参考文献"
 * is translated.
 *
 * KaTeX and its CSS are imported here at the top of the file so the
 * lazy chunk Vite emits for this component carries them. The main
 * calculator bundle stays free of the ~73 KB-gzipped KaTeX payload
 * until the user actually clicks the details link.
 */

import 'katex/dist/katex.min.css';
import { BlockMath, InlineMath } from 'react-katex';
import { Trans, useTranslation } from 'react-i18next';
import { Citation } from './Citation';
import { ComparisonSection } from './ComparisonSection';

/** Bibliography entry. Authors / title / venue stay in English on both
 *  locales; only the "References" heading is translated. */
interface Reference {
  id: number;
  authors: string;
  title: string;
  venue: string;
  year: number;
}

const REFERENCES: Reference[] = [
  {
    id: 1,
    authors: 'H. A. Wheeler',
    title:
      'Transmission-line properties of a strip on a dielectric sheet on a plane',
    venue: 'IEEE Trans. Microwave Theory Tech., vol. 25, no. 8, pp. 631–647',
    year: 1977,
  },
  {
    id: 2,
    authors: 'E. Hammerstad and Ø. Jensen',
    title: 'Accurate models for microstrip computer-aided design',
    venue: 'IEEE MTT-S Int. Microwave Symp. Dig., pp. 407–409',
    year: 1980,
  },
  {
    id: 3,
    authors: 'M. Kirschning and R. H. Jansen',
    title:
      'Accurate model for effective dielectric constant of microstrip with validity up to millimetre-wave frequencies',
    venue: 'Electron. Lett., vol. 18, no. 6, pp. 272–273',
    year: 1982,
  },
  {
    id: 4,
    authors: 'D. M. Pozar',
    title: 'Microwave Engineering',
    venue: '4th ed., Wiley, §3.8',
    year: 2011,
  },
  {
    id: 5,
    authors: 'J. Jin',
    title: 'The Finite Element Method in Electromagnetics',
    venue: '3rd ed., Wiley',
    year: 2014,
  },
  {
    id: 6,
    authors: 'J. R. Shewchuk',
    title:
      'Triangle: Engineering a 2D quality mesh generator and Delaunay triangulator',
    venue: 'Applied Computational Geometry, LNCS vol. 1148, Springer, pp. 203–222',
    year: 1996,
  },
];

export interface DetailsPageProps {
  /** Called when the user wants to leave the page and return to the
   *  calculator. */
  onBack: () => void;
}

export function DetailsPage(props: DetailsPageProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="details-page">
      <header className="details-page__header">
        <button
          type="button"
          className="details-page__back"
          onClick={props.onBack}
        >
          ← {t('details.back')}
        </button>
        <h1 className="details-page__title">{t('details.title')}</h1>
      </header>

      <p className="details-page__intro">{t('details.intro')}</p>

      {/* ────────── Table of contents ────────── */}
      <nav className="details-page__toc" aria-label={t('details.tocTitle')}>
        <h2 className="details-page__toc-title">{t('details.tocTitle')}</h2>
        <ol>
          <li><a href="#sec1">{t('details.toc.sec1')}</a></li>
          <li><a href="#sec2">{t('details.toc.sec2')}</a></li>
          <li><a href="#sec3">{t('details.toc.sec3')}</a></li>
          <li><a href="#sec4">{t('details.toc.sec4')}</a></li>
          <li><a href="#sec5">{t('details.toc.sec5')}</a></li>
          <li><a href="#references">{t('details.toc.references')}</a></li>
        </ol>
      </nav>

      {/* ────────── §1. Closed-form formulas ────────── */}
      <section className="details-page__section" id="sec1">
        <h2>{t('details.sec1.title')}</h2>

        <h3>{t('details.sec1.wheelerTitle')}</h3>
        <p>
          <Trans
            i18nKey="details.sec1.wheelerBody"
            components={{
              cite1: <Citation n={1} />,
              cite4: <Citation n={4} />,
            }}
          />
        </p>
        <BlockMath
          math={String.raw`\varepsilon_\mathrm{eff} = \frac{\varepsilon_r + 1}{2} + \frac{\varepsilon_r - 1}{2}\left(1 + 12\,\frac{h}{W}\right)^{-1/2}`}
        />
        <BlockMath
          math={String.raw`Z_0 = \frac{120\pi}{\sqrt{\varepsilon_\mathrm{eff}}\,\bigl[\,W/h \;+\; 1.393 \;+\; 0.667\,\ln\!\left(W/h + 1.444\right)\,\bigr]}`}
        />
        <p className="details-page__caption">
          {t('details.sec1.wheelerCaption')}
        </p>

        <h3>{t('details.sec1.hjTitle')}</h3>
        <p>
          <Trans
            i18nKey="details.sec1.hjBody"
            components={{ cite2: <Citation n={2} /> }}
          />
        </p>
        <BlockMath
          math={String.raw`\varepsilon_\mathrm{eff} = \frac{\varepsilon_r + 1}{2} + \frac{\varepsilon_r - 1}{2}\left(1 + \frac{10}{u}\right)^{-a(u)\,b(\varepsilon_r)}, \qquad u = W/h`}
        />
        <p className="details-page__caption">
          {t('details.sec1.hjCaption')}
        </p>

        <h3>{t('details.sec1.commonTitle')}</h3>
        <p>
          <Trans
            i18nKey="details.sec1.commonBody"
            components={{
              cite1: <Citation n={1} />,
              cite2: <Citation n={2} />,
              cite3: <Citation n={3} />,
            }}
          />
        </p>
      </section>

      {/* ────────── §2. 2D FEM principle ────────── */}
      <section className="details-page__section" id="sec2">
        <h2>{t('details.sec2.title')}</h2>

        <p>{t('details.sec2.intro')}</p>
        <BlockMath
          math={String.raw`\nabla \cdot \bigl(\varepsilon_r(x,y)\,\nabla\varphi\bigr) = 0 \quad \text{in } \Omega`}
        />
        <p className="details-page__caption">{t('details.sec2.bvpCaption')}</p>

        <p>
          <Trans
            i18nKey="details.sec2.weakBody"
            components={{ cite4: <Citation n={4} />, cite5: <Citation n={5} /> }}
          />
        </p>
        <BlockMath
          math={String.raw`\int_{\Omega} \varepsilon_r\,\nabla\varphi \cdot \nabla v \,\mathrm{d}A = 0 \quad \forall\, v \in H^{1}_{0}(\Omega)`}
        />

        <p>{t('details.sec2.energyBody')}</p>
        <BlockMath
          math={String.raw`\frac{C}{L} = \varepsilon_0\,\boldsymbol{\varphi}^{\!\top} K\,\boldsymbol{\varphi}, \qquad Z_0 = \frac{1}{c\,\sqrt{C\,C_0}}, \qquad \varepsilon_\mathrm{eff} = \frac{C}{C_0}`}
        />
        <p className="details-page__caption">
          {t('details.sec2.energyCaption')}
        </p>

        <p className="details-page__why-better">
          {t('details.sec2.whyBetter')}
        </p>
      </section>

      {/* ────────── §3. Mesh + computational notes ────────── */}
      <section className="details-page__section" id="sec3">
        <h2>{t('details.sec3.title')}</h2>
        <p>
          <Trans
            i18nKey="details.sec3.body"
            components={{
              cite3: <Citation n={3} />,
              cite6: <Citation n={6} />,
              eta: <InlineMath math={String.raw`\eta^{2}`} />,
            }}
          />
        </p>
      </section>

      {/* ────────── §4. Comparison plots ────────── */}
      <section className="details-page__section" id="sec4">
        <h2>{t('details.sec4.title')}</h2>
        <p>{t('details.sec4.intro')}</p>
        <ComparisonSection />
      </section>

      {/* ────────── §5. Usage guide ────────── */}
      <section className="details-page__section" id="sec5">
        <h2>{t('details.sec5.title')}</h2>
        <p>{t('details.sec5.intro')}</p>

        <h3>{t('details.sec5.simpleTitle')}</h3>
        <p>{t('details.sec5.simpleBody')}</p>

        <h3>{t('details.sec5.advancedTitle')}</h3>
        <p>{t('details.sec5.advancedBody')}</p>

        <h3>{t('details.sec5.tipsTitle')}</h3>
        <p className="details-page__tips">{t('details.sec5.tipsBody')}</p>
      </section>

      {/* ────────── References ────────── */}
      <section className="details-page__references" id="references">
        <h2>{t('details.references')}</h2>
        <ol>
          {REFERENCES.map((ref) => (
            <li key={ref.id} id={`ref-${ref.id}`}>
              {ref.authors}, &ldquo;{ref.title},&rdquo; <em>{ref.venue}</em>,{' '}
              {ref.year}.
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
