import { useTranslation } from 'react-i18next';

export type UiMode = 'simple' | 'advanced';

const MODES: readonly UiMode[] = ['simple', 'advanced'] as const;

interface ModeToggleProps {
  value: UiMode;
  onChange: (mode: UiMode) => void;
}

export function ModeToggle({ value, onChange }: ModeToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mode-toggle" role="group" aria-label={t('app.mode.label')}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`mode-toggle__btn${value === mode ? ' mode-toggle__btn--active' : ''}`}
          onClick={() => {
            if (mode !== value) onChange(mode);
          }}
          aria-pressed={value === mode}
        >
          {t(`app.mode.${mode}`)}
        </button>
      ))}
    </div>
  );
}
