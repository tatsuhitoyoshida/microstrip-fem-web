/**
 * Smoke tests for the Phase 6 UI components — they should mount and render
 * stable static views without throwing. Heavy interactive flows (FEM solve
 * triggered by Calculate, etc.) are covered by the FEM-level tests
 * elsewhere; this file is a guardrail against import / type / render errors.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { About } from '../src/components/About';
import { ComparisonTable } from '../src/components/ComparisonTable';
import { ParameterForm } from '../src/components/ParameterForm';
import { ResultsPanel } from '../src/components/ResultsPanel';

describe('UI components smoke', () => {
  it('About renders with the expected sections', () => {
    render(<About />);
    expect(screen.getByRole('heading', { name: /about this tool/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /github/i })).toBeInTheDocument();
  });

  it('ParameterForm renders inputs and buttons', () => {
    render(<ParameterForm isLoading={false} onCalculate={() => {}} onFindOptimalW={() => {}} />);
    expect(screen.getByLabelText(/trace width/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/substrate height/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^calculate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find w/i })).toBeInTheDocument();
  });

  it('ResultsPanel without a result prompts the user to press Calculate', () => {
    render(<ResultsPanel result={null} isLoading={false} error={null} unit="mm" />);
    expect(screen.getByText(/press calculate/i)).toBeInTheDocument();
  });

  it('ResultsPanel surfaces errors', () => {
    render(<ResultsPanel result={null} isLoading={false} error="kaboom" unit="mm" />);
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });

  it('ComparisonTable shows a placeholder when there is no result', () => {
    render(<ComparisonTable result={null} />);
    expect(screen.getByText(/no results yet/i)).toBeInTheDocument();
  });
});
