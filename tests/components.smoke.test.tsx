/**
 * Smoke tests for the UI components — they should mount and render stable
 * static views without throwing. Heavy interactive flows (FEM solve
 * triggered by Calculate, etc.) are covered by the FEM-level tests
 * elsewhere; this file is a guardrail against import / type / render errors,
 * and a check that the Simple / Advanced split surfaces / hides the right
 * fields.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GeometryDiagram } from '../src/components/GeometryDiagram';
import { ParameterForm } from '../src/components/ParameterForm';
import { ResultsPanel } from '../src/components/ResultsPanel';
import { WhatIsThis } from '../src/components/WhatIsThis';

describe('UI components smoke', () => {
  it('WhatIsThis renders the heading and a detail link', () => {
    render(<WhatIsThis />);
    expect(screen.getByRole('heading', { name: /what is this/i })).toBeInTheDocument();
    // The detail link appears in the last paragraph and currently points
    // at the GitHub README until the dedicated /docs page lands.
    const link = screen.getByRole('link', { name: /here/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('github.com'));
  });

  it('GeometryDiagram renders an accessible SVG schematic', () => {
    render(<GeometryDiagram />);
    expect(screen.getByRole('img', { name: /reference cross-section/i })).toBeInTheDocument();
  });

  it('ParameterForm in simple mode shows core inputs + frequency + both directions', () => {
    render(
      <ParameterForm
        mode="simple"
        isLoading={false}
        frequency={1}
        onFrequencyChange={() => {}}
        onCalculate={() => {}}
        onFindOptimalW={() => {}}
      />,
    );
    expect(screen.getByLabelText(/trace width/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/substrate height/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/conductor thickness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/relative permittivity/i)).toBeInTheDocument();
    // Frequency is now a working field in simple mode (drives λ_g display).
    expect(screen.getByLabelText(/frequency/i)).toBeInTheDocument();
    // Both directions (forward + inverse) are reachable in simple mode.
    expect(screen.getByLabelText(/target z₀/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^calculate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument();
    // Advanced-only controls should be absent. tan δ has been removed entirely
    // (was a non-functional v0.1 placeholder).
    expect(screen.queryByLabelText(/loss tangent/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/tolerance ±/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/adaptive mesh/i)).not.toBeInTheDocument();
  });

  it('ParameterForm in advanced mode also exposes tolerance and adaptive controls', () => {
    render(
      <ParameterForm
        mode="advanced"
        isLoading={false}
        frequency={1}
        onFrequencyChange={() => {}}
        onCalculate={() => {}}
        onFindOptimalW={() => {}}
      />,
    );
    expect(screen.getByLabelText(/frequency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target z₀/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tolerance ±/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument();
    expect(screen.getByText(/adaptive mesh/i)).toBeInTheDocument();
    // tan δ has been removed (v0.1 has no loss model — re-add when v0.2 lands).
    expect(screen.queryByLabelText(/loss tangent/i)).not.toBeInTheDocument();
  });

  it('ResultsPanel without a result prompts the user to press Calculate', () => {
    render(
      <ResultsPanel
        mode="simple"
        result={null}
        isLoading={false}
        progress={null}
        passPreviews={[]}
        selectedPassIndex={null}
        onSelectPass={() => {}}
        error={null}
        unit="mm"
        frequency={1}
      />,
    );
    expect(screen.getByText(/press calculate/i)).toBeInTheDocument();
  });

  it('ResultsPanel surfaces errors', () => {
    render(
      <ResultsPanel
        mode="simple"
        result={null}
        isLoading={false}
        progress={null}
        passPreviews={[]}
        selectedPassIndex={null}
        onSelectPass={() => {}}
        error="kaboom"
        unit="mm"
        frequency={1}
      />,
    );
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });

});
