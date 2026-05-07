import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { About } from './components/About';
import { ComparisonTable } from './components/ComparisonTable';
import { CrossSectionPlot } from './components/CrossSectionPlot';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { ParameterForm } from './components/ParameterForm';
import { ResultsPanel } from './components/ResultsPanel';
import { useMicrostripCalc } from './hooks/useMicrostripCalc';
import type { LengthUnit } from './lib/units';
import './App.css';

function App(): React.ReactElement {
  const { t } = useTranslation();
  const { result, isLoading, progress, error, computeForward, findOptimalW } = useMicrostripCalc();
  const [showAbout, setShowAbout] = useState(false);
  // The form is the source of truth for the display unit; we only need it
  // here for the panels that render derived lengths.
  const [unit] = useState<LengthUnit>('mm');

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-titles">
          <h1>{t('app.title')}</h1>
          <a
            className="app__brand"
            href="https://photonic-edge.com"
            target="_blank"
            rel="noreferrer"
          >
            {t('app.brand')}
          </a>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="app__main">
        <aside className="app__form">
          <ParameterForm
            isLoading={isLoading}
            onCalculate={(p) => void computeForward(p)}
            onFindOptimalW={(target, fixed) => void findOptimalW(target, fixed)}
          />
          <button
            type="button"
            className="app__about-toggle"
            onClick={() => setShowAbout((v) => !v)}
          >
            {showAbout ? t('about.toggleHide') : t('about.toggleShow')}
          </button>
          {showAbout && <About />}
        </aside>

        <section className="app__viz">
          <CrossSectionPlot result={result} />
          <ResultsPanel
            result={result}
            isLoading={isLoading}
            progress={progress}
            error={error}
            unit={unit}
          />
          <ComparisonTable result={result} />
        </section>
      </main>
    </div>
  );
}

export default App;
