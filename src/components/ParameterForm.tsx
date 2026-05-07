/**
 * Input panel: trace width, substrate height, conductor thickness, εr,
 * and the optional target Z₀ used by the bisection search.
 *
 * Display values track the currently-selected length unit (mm or mil); on
 * unit toggle they're rescaled in place so the user sees the same physical
 * value with new digits. The form converts back to mm when handing the
 * params to the parent on submit.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LengthUnit, MIL_TO_MM, toMm } from '../lib/units';
import type { MicrostripParams } from '../types';

export interface ParameterFormProps {
  isLoading: boolean;
  onCalculate: (params: MicrostripParams) => void;
  onFindOptimalW: (targetZ0: number, fixed: Omit<MicrostripParams, 'width'>) => void;
}

const DEFAULTS = {
  width: 3.0, // mm
  height: 1.6, // mm
  thickness: 0.035, // mm
  epsilonR: 4.4,
  targetZ0: 50, // Ω
};

export function ParameterForm({
  isLoading,
  onCalculate,
  onFindOptimalW,
}: ParameterFormProps): React.ReactElement {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<LengthUnit>('mm');
  const [width, setWidth] = useState(DEFAULTS.width);
  const [height, setHeight] = useState(DEFAULTS.height);
  const [thickness, setThickness] = useState(DEFAULTS.thickness);
  const [epsilonR, setEpsilonR] = useState(DEFAULTS.epsilonR);
  const [targetZ0, setTargetZ0] = useState(DEFAULTS.targetZ0);

  const handleUnitChange = (next: LengthUnit): void => {
    if (next === unit) return;
    const factor = next === 'mil' ? 1 / MIL_TO_MM : MIL_TO_MM;
    setWidth(width * factor);
    setHeight(height * factor);
    setThickness(thickness * factor);
    setUnit(next);
  };

  const lengthsValid = width > 0 && height > 0 && thickness >= 0;
  const physicsValid = epsilonR >= 1;
  const allValid = lengthsValid && physicsValid;
  const targetValid = Number.isFinite(targetZ0) && targetZ0 > 0;

  const collectParams = (): MicrostripParams => ({
    width: toMm(width, unit),
    height: toMm(height, unit),
    thickness: toMm(thickness, unit),
    epsilonR,
  });

  const handleCalculate = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!allValid || isLoading) return;
    onCalculate(collectParams());
  };

  const handleFindW = (): void => {
    if (!allValid || !targetValid || isLoading) return;
    const all = collectParams();
    onFindOptimalW(targetZ0, {
      height: all.height,
      thickness: all.thickness,
      epsilonR: all.epsilonR,
    });
  };

  return (
    <form className="parameter-form" onSubmit={handleCalculate}>
      <h2>{t('form.title')}</h2>

      <fieldset className="unit-toggle">
        <legend>{t('form.unitsLegend')}</legend>
        <label>
          <input
            type="radio"
            name="unit"
            value="mm"
            checked={unit === 'mm'}
            onChange={() => handleUnitChange('mm')}
          />
          mm
        </label>
        <label>
          <input
            type="radio"
            name="unit"
            value="mil"
            checked={unit === 'mil'}
            onChange={() => handleUnitChange('mil')}
          />
          mil
        </label>
      </fieldset>

      <NumberField
        id="param-w"
        label={t('form.width', { unit })}
        value={width}
        onChange={setWidth}
        step={unit === 'mm' ? 0.01 : 1}
        min={0}
      />
      <NumberField
        id="param-h"
        label={t('form.height', { unit })}
        value={height}
        onChange={setHeight}
        step={unit === 'mm' ? 0.01 : 1}
        min={0}
      />
      <NumberField
        id="param-t"
        label={t('form.thickness', { unit })}
        value={thickness}
        onChange={setThickness}
        step={unit === 'mm' ? 0.001 : 0.1}
        min={0}
      />
      <NumberField
        id="param-er"
        label={t('form.epsilonR')}
        value={epsilonR}
        onChange={setEpsilonR}
        step={0.01}
        min={1}
      />

      <hr />

      <NumberField
        id="param-target"
        label={t('form.targetZ0')}
        value={targetZ0}
        onChange={setTargetZ0}
        step={0.5}
        min={0}
      />

      <div className="parameter-form__buttons">
        <button type="submit" disabled={!allValid || isLoading}>
          {t('form.calculate')}
        </button>
        <button
          type="button"
          onClick={handleFindW}
          disabled={!allValid || !targetValid || isLoading}
          title={t('form.findWTooltip')}
        >
          {t('form.findW')}
        </button>
      </div>
    </form>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step,
  min,
}: NumberFieldProps): React.ReactElement {
  return (
    <div className="number-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}
