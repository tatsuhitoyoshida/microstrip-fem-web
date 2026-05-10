/**
 * Input panel: trace width, substrate height, conductor thickness, εr,
 * and the optional target Z₀ used by the bisection search.
 *
 * Display values track the currently-selected length unit (mm or mil); on
 * unit toggle they're rescaled in place so the user sees the same physical
 * value with new digits. The form converts back to mm when handing the
 * params to the parent on submit.
 *
 * Sections are split so both the forward (W → Z₀) and inverse (Z₀ → W)
 * flows are reachable in *both* presentation modes:
 *
 *  - simple   — common stack (h, t, εr) + forward (W) + inverse (target Z₀).
 *               No tan δ / frequency placeholders, no adaptive controls.
 *  - advanced — adds: disabled tan δ / frequency placeholders inside the
 *               stack, an extra tolerance ± [%] field on the inverse, and
 *               the adaptive-mesh controls panel.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GeometryDiagram } from './GeometryDiagram';
import { NumberField } from './NumberField';
import { type LengthUnit, MIL_TO_MM, toMm } from '../lib/units';
import type { UiMode } from './ModeToggle';
import type { MicrostripParams } from '../types';

/** Adaptive-meshing knobs the form exposes to the parent. */
export interface AdaptiveSettings {
  /** Run the iterative refinement loop (default ON). */
  enabled: boolean;
  /** ΔZ₀ stopping tolerance [Ω]. Default 0.05. */
  tolerance: number;
  /** Hard cap on adaptive passes. Default 20. */
  maxPasses: number;
}

export interface ParameterFormProps {
  mode: UiMode;
  isLoading: boolean;
  /**
   * Frequency in GHz, owned by the parent so it can flow into ResultsPanel
   * for λ_g / λ_0 post-processing. Frequency is NOT part of MicrostripParams
   * because the quasi-static FEM solve doesn't depend on it.
   */
  frequency: number;
  onFrequencyChange: (next: number) => void;
  onCalculate: (params: MicrostripParams, adaptive: AdaptiveSettings) => void;
  onFindOptimalW: (
    targetZ0: number,
    fixed: Omit<MicrostripParams, 'width'>,
    adaptive: AdaptiveSettings,
    /** Bisection tolerance as a percentage of the target Z₀, e.g. 1 for ±1 %. */
    tolerancePct: number,
    /** Operating frequency in GHz, threaded into the bisection so it
     *  targets the dispersion-corrected Z₀(f) rather than the static value. */
    frequencyGHz: number,
  ) => void;
}

const DEFAULTS = {
  width: 3.0, // mm
  height: 1.6, // mm
  thickness: 0.035, // mm
  epsilonR: 4.4,
  targetZ0: 50, // Ω
  findWTolerancePct: 1.0, // ±1 % of targetZ0
  adaptiveEnabled: true,
  adaptiveTolerance: 0.05, // Ω
  adaptiveMaxPasses: 20,
};

export function ParameterForm({
  mode,
  isLoading,
  frequency,
  onFrequencyChange,
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
  const [findWTolerancePct, setFindWTolerancePct] = useState(DEFAULTS.findWTolerancePct);
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(DEFAULTS.adaptiveEnabled);
  const [adaptiveTolerance, setAdaptiveTolerance] = useState(DEFAULTS.adaptiveTolerance);
  const [adaptiveMaxPasses, setAdaptiveMaxPasses] = useState(DEFAULTS.adaptiveMaxPasses);

  const handleUnitChange = (next: LengthUnit): void => {
    if (next === unit) return;
    const factor = next === 'mil' ? 1 / MIL_TO_MM : MIL_TO_MM;
    // Round to 3 decimals on conversion so the display stays clean
    // (e.g. 3 mm → 118.110 mil instead of 118.11023622...).
    const round3 = (x: number): number => Math.round(x * 1000) / 1000;
    setWidth(round3(width * factor));
    setHeight(round3(height * factor));
    setThickness(round3(thickness * factor));
    setUnit(next);
  };

  const lengthsValid = width > 0 && height > 0 && thickness >= 0;
  const physicsValid = epsilonR >= 1;
  const toleranceValid = Number.isFinite(adaptiveTolerance) && adaptiveTolerance > 0;
  const maxPassesValid =
    Number.isInteger(adaptiveMaxPasses) && adaptiveMaxPasses >= 1 && adaptiveMaxPasses <= 50;
  // Adaptive validity only matters in advanced mode where the user can edit
  // the values; in simple mode we always run with defaults so the form is
  // valid regardless of any (untouched) state.
  const adaptiveValid =
    mode === 'simple' || !adaptiveEnabled || (toleranceValid && maxPassesValid);
  const allValid = lengthsValid && physicsValid && adaptiveValid;
  const targetValid =
    Number.isFinite(targetZ0) &&
    targetZ0 > 0 &&
    Number.isFinite(findWTolerancePct) &&
    findWTolerancePct > 0;

  const collectParams = (): MicrostripParams => ({
    width: toMm(width, unit),
    height: toMm(height, unit),
    thickness: toMm(thickness, unit),
    epsilonR,
  });

  const collectAdaptive = (): AdaptiveSettings => ({
    enabled: adaptiveEnabled,
    tolerance: adaptiveTolerance,
    maxPasses: adaptiveMaxPasses,
  });

  const handleCalculate = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!allValid || isLoading) return;
    onCalculate(collectParams(), collectAdaptive());
  };

  const handleFindW = (): void => {
    if (!allValid || !targetValid || isLoading) return;
    const all = collectParams();
    onFindOptimalW(
      targetZ0,
      {
        height: all.height,
        thickness: all.thickness,
        epsilonR: all.epsilonR,
      },
      collectAdaptive(),
      findWTolerancePct,
      frequency,
    );
  };

  return (
    <form className="parameter-form" onSubmit={handleCalculate}>
      <h2>{t('form.title')}</h2>
      <GeometryDiagram />

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

      {/* Substrate / dielectric — common to forward and inverse flows. */}
      <fieldset className="form-section form-section--stack">
        <legend>{t('form.layerStackLegend')}</legend>
        <NumberField
          id="param-h"
          label={t('form.height', { unit })}
          value={height}
          onChange={setHeight}
          step={0.001}
          min={0}
        />
        <NumberField
          id="param-t"
          label={t('form.thickness', { unit })}
          value={thickness}
          onChange={setThickness}
          step={0.001}
          min={0}
        />
        <NumberField
          id="param-er"
          label={t('form.epsilonR')}
          value={epsilonR}
          onChange={setEpsilonR}
          step={0.001}
          min={1}
        />
        <NumberField
          id="param-freq"
          label={t('form.frequency')}
          value={frequency}
          onChange={onFrequencyChange}
          step={0.1}
          min={0}
        />
      </fieldset>

      {/* Forward direction: W → Z₀ */}
      <fieldset className="form-section form-section--forward">
        <legend>{t('form.forwardLegend')}</legend>
        <NumberField
          id="param-w"
          label={t('form.width', { unit })}
          value={width}
          onChange={setWidth}
          step={0.001}
          min={0}
        />
        <button
          type="submit"
          className="parameter-form__btn parameter-form__btn--primary"
          disabled={!allValid || isLoading}
        >
          {isLoading && <span className="spinner" aria-hidden="true" />}
          {t('form.calculate')}
        </button>
      </fieldset>

      {/* Inverse direction: target Z₀ → W (bisection). Available in both modes. */}
      <fieldset className="form-section form-section--inverse">
        <legend>{t('form.inverseLegend')}</legend>
        <NumberField
          id="param-target"
          label={t('form.targetZ0')}
          value={targetZ0}
          onChange={setTargetZ0}
          step={0.001}
          min={0}
        />
        {mode === 'advanced' && (
          <NumberField
            id="param-tolerance-pct"
            label={t('form.tolerancePct')}
            value={findWTolerancePct}
            onChange={setFindWTolerancePct}
            step={0.001}
            min={0.001}
          />
        )}
        <button
          type="button"
          className="parameter-form__btn parameter-form__btn--secondary"
          onClick={handleFindW}
          disabled={!allValid || !targetValid || isLoading}
          title={t('form.findWTooltip')}
        >
          {isLoading && <span className="spinner" aria-hidden="true" />}
          {t('form.findW')}
        </button>
      </fieldset>

      {mode === 'advanced' && (
        <fieldset className="form-section adaptive-settings">
          <legend>{t('form.adaptiveLegend')}</legend>
          <label className="adaptive-settings__toggle">
            <input
              type="checkbox"
              checked={adaptiveEnabled}
              onChange={(e) => setAdaptiveEnabled(e.target.checked)}
            />
            {t('form.adaptiveEnable')}
          </label>
          <NumberField
            id="param-adaptive-tol"
            label={t('form.adaptiveTolerance')}
            value={adaptiveTolerance}
            onChange={setAdaptiveTolerance}
            step={0.0001}
            min={0.0001}
            disabled={!adaptiveEnabled}
          />
          <NumberField
            id="param-adaptive-max-passes"
            label={t('form.adaptiveMaxPasses')}
            value={adaptiveMaxPasses}
            onChange={(v) => setAdaptiveMaxPasses(Math.round(v))}
            step={1}
            min={1}
            disabled={!adaptiveEnabled}
          />
          <p className="adaptive-settings__hint">{t('form.adaptiveHint')}</p>
        </fieldset>
      )}
    </form>
  );
}

// NumberField now lives in its own module so other panels (e.g.
// FullWavePage) can reuse it. See `src/components/NumberField.tsx`.
