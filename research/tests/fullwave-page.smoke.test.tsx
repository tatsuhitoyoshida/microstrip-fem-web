/**
 * Smoke test for the experimental Full-wave page. Mocks the
 * `useFullWaveCalc` hook so the test doesn't spin up a real Web
 * Worker (Vite's `?worker` import isn't natively wired into
 * vitest's Node runtime).
 *
 * What's asserted:
 *   - the disclaimer header is visible (load-bearing warning)
 *   - the Run button is present and the Back button exists
 *   - the standard microstrip parameter inputs render
 *   - the experimental-frequency warning surfaces below 20 GHz
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Hoist the mock so the import in FullWavePage picks it up.
vi.mock('../src/hooks/useFullWaveCalc', () => ({
  useFullWaveCalc: () => ({
    result: null,
    isLoading: false,
    error: null,
    compute: vi.fn(),
  }),
}));

import { FullWavePage } from '../src/components/FullWavePage';

describe('FullWavePage smoke', () => {
  it('renders the disclaimer, back button, and run button', () => {
    render(<FullWavePage onBack={() => {}} />);
    // Disclaimer header — load-bearing warning, must be visible.
    expect(
      screen.getByText(/experimental.*not for production/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to calculator/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run full-wave solve/i })).toBeInTheDocument();
  });

  it('shows microstrip parameter inputs', () => {
    render(<FullWavePage onBack={() => {}} />);
    expect(screen.getByLabelText(/trace width/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/substrate height/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/conductor thickness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/relative permittivity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/frequency/i)).toBeInTheDocument();
  });

  it('shows a low-frequency warning when the user enters < 20 GHz', () => {
    const { container } = render(<FullWavePage onBack={() => {}} />);
    const freqInput = screen.getByLabelText(/frequency/i);
    fireEvent.change(freqInput, { target: { value: '10' } });
    // The warning is a distinct paragraph (`.fullwave-page__warn`).
    // The disclaimer body mentions the same threshold but lives
    // outside the form; query by class to disambiguate.
    const warn = container.querySelector('.fullwave-page__warn');
    expect(warn).toBeTruthy();
    expect(warn?.textContent ?? '').toMatch(/stagnates/i);
    // Run button should also be disabled at sub-20-GHz.
    expect(screen.getByRole('button', { name: /run full-wave solve/i })).toBeDisabled();
  });

  it('invokes onBack when the back button is clicked', () => {
    const onBack = vi.fn();
    render(<FullWavePage onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back to calculator/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
