import { useState } from 'react';

/**
 * Numeric input with a local string buffer so the user can clear the
 * field, retype, and key through partial decimals (e.g. "0." on the
 * way to "0.04") without the parent state silently snapping to zero.
 *
 * Without the buffer the browser fires `onChange` with `""` on clear,
 * `Number("")` returns 0, and the form bounces to invalid mid-key.
 *
 * Extracted from `ParameterForm` so other panels (e.g. `FullWavePage`)
 * can reuse the same input UX without copying ~50 lines of state
 * plumbing.
 */
export interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  disabled?: boolean;
  hint?: string;
  /** Optional unit suffix label rendered alongside the field. */
  unitLabel?: string;
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  step,
  min,
  disabled,
  hint,
  unitLabel,
}: NumberFieldProps): React.ReactElement {
  const [text, setText] = useState<string>(() => String(value));
  // React-recommended pattern: resync derived state by comparing the
  // previous prop in state during render rather than through useEffect.
  // React bails the second render out when nothing else changed.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    if (Number(text) !== value) {
      setText(String(value));
    }
  }

  return (
    <div className={`number-field${disabled ? ' number-field--disabled' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="number-field__row">
        <input
          id={id}
          type="number"
          value={text}
          step={step}
          min={min}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            // Skip parent update for empty / partial inputs.
            if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => {
            if (text === '' || !Number.isFinite(Number(text))) {
              setText(String(value));
            }
          }}
        />
        {unitLabel && <span className="number-field__unit">{unitLabel}</span>}
      </div>
      {hint && <p className="number-field__hint">{hint}</p>}
    </div>
  );
}
