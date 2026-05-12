/**
 * Smoke tests for the UI components — they should mount and render stable
 * static views without throwing. Heavy interactive flows (FEM solve
 * triggered by Calculate, etc.) are covered by the FEM-level tests
 * elsewhere; this file is a guardrail against import / type / render errors,
 * and a check that the Simple / Advanced split surfaces / hides the right
 * fields.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GeometryDiagram } from '../src/components/GeometryDiagram';
import { ParameterForm } from '../src/components/ParameterForm';
import { ResultsPanel } from '../src/components/ResultsPanel';
import { ToolNav } from '../src/components/ToolNav';
import { WhatIsThis } from '../src/components/WhatIsThis';

// Stub KaTeX so the DetailsPage smoke test doesn't have to pull in
// the real renderer (and its WOFF2 font requests) inside jsdom. Each
// stub renders the raw LaTeX in a tagged element so the smoke
// assertions can still count formula blocks.
vi.mock('react-katex', () => ({
  BlockMath: ({ math }: { math: string }): React.ReactElement => (
    <div data-testid="block-math">{math}</div>
  ),
  InlineMath: ({ math }: { math: string }): React.ReactElement => (
    <span data-testid="inline-math">{math}</span>
  ),
}));
vi.mock('katex/dist/katex.min.css', () => ({}));

// Stub the FEM worker and Plotly so DetailsPage's §4 ComparisonSection
// can mount in jsdom (no real Worker class, no real Plotly bundle).
// The worker default export is a *constructor*, so the stub has to be
// a class — a `vi.fn()` returning an object isn't callable with `new`.
vi.mock('../src/workers/femWorker.ts?worker', () => {
  class FemWorkerStub {
    postMessage = vi.fn();
    terminate = vi.fn();
    onmessage: ((e: MessageEvent) => void) | null = null;
  }
  return { default: FemWorkerStub };
});
vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn(() => Promise.resolve()),
    purge: vi.fn(),
  },
}));

import { DetailsPage } from '../src/components/DetailsPage';

describe('UI components smoke', () => {
  it('WhatIsThis renders the heading and invokes onShowDetails when its trigger is clicked', () => {
    const onShowDetails = vi.fn();
    render(<WhatIsThis onShowDetails={onShowDetails} />);
    expect(screen.getByRole('heading', { name: /what is this/i })).toBeInTheDocument();
    // The trigger is now a <button> (not an <a>) that switches the
    // top-level App view to the in-app details page.
    const trigger = screen.getByRole('button', { name: /here|こちら/i });
    fireEvent.click(trigger);
    expect(onShowDetails).toHaveBeenCalledTimes(1);
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

describe('ToolNav smoke', () => {
  it('renders the Transmission Line category tab', () => {
    render(<ToolNav activeToolId="microstrip" onSelectTool={() => {}} />);
    expect(
      screen.getByRole('button', { name: /transmission line|伝送線路/i }),
    ).toBeInTheDocument();
  });

  it('opens a menu listing Microstrip + Coming-soon entries when the tab is clicked', () => {
    render(<ToolNav activeToolId="microstrip" onSelectTool={() => {}} />);
    fireEvent.click(
      screen.getByRole('button', { name: /transmission line|伝送線路/i }),
    );
    // Microstrip (available) and the three coming-soon items all appear as
    // menuitems; available ones are enabled, others are disabled.
    const microstripItem = screen.getByRole('menuitem', {
      name: /microstrip|マイクロストリップ/i,
    });
    expect(microstripItem).toBeEnabled();
    const striplineItem = screen.getByRole('menuitem', {
      name: /stripline|ストリップライン/i,
    });
    expect(striplineItem).toBeDisabled();
  });

  it('invokes onSelectTool with the tool id when an available menuitem is clicked', () => {
    const onSelect = vi.fn();
    render(<ToolNav activeToolId="microstrip" onSelectTool={onSelect} />);
    fireEvent.click(
      screen.getByRole('button', { name: /transmission line|伝送線路/i }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: /microstrip|マイクロストリップ/i }),
    );
    expect(onSelect).toHaveBeenCalledWith('microstrip');
  });

  it('does not invoke onSelectTool when a coming-soon entry is clicked', () => {
    const onSelect = vi.fn();
    render(<ToolNav activeToolId="microstrip" onSelectTool={onSelect} />);
    fireEvent.click(
      screen.getByRole('button', { name: /transmission line|伝送線路/i }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: /stripline|ストリップライン/i }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes the menu after a tool is picked', () => {
    render(<ToolNav activeToolId="microstrip" onSelectTool={() => {}} />);
    const tab = screen.getByRole('button', {
      name: /transmission line|伝送線路/i,
    });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(
      screen.getByRole('menuitem', { name: /microstrip|マイクロストリップ/i }),
    );
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('DetailsPage smoke', () => {
  it('renders the back button, title, all five sections, and the references list', () => {
    render(<DetailsPage onBack={() => {}} />);
    // Back button is the entry-point off the page.
    expect(
      screen.getByRole('button', { name: /back|戻る/i }),
    ).toBeInTheDocument();
    // Top-level title from `details.title`.
    expect(
      screen.getByRole('heading', { level: 1, name: /how this|このツール/i }),
    ).toBeInTheDocument();
    // References heading is the last h2.
    expect(
      screen.getByRole('heading', { name: /references|参考文献/i }),
    ).toBeInTheDocument();
    // Each numbered section has a stable `id="secN"` anchor for the TOC.
    for (const id of ['sec1', 'sec2', 'sec3', 'sec4', 'sec5', 'references']) {
      expect(document.getElementById(id), `#${id} should exist`).not.toBeNull();
    }
    // 6 bibliography entries (Wheeler, HJ, KJ, Pozar, Jin, Shewchuk).
    for (let n = 1; n <= 6; n++) {
      const li = document.getElementById(`ref-${n}`);
      expect(li, `<li id="ref-${n}"> should exist`).not.toBeNull();
    }
  });

  it('renders a table of contents with anchor links into each section', () => {
    render(<DetailsPage onBack={() => {}} />);
    // The TOC <nav> exposes its aria-label as an accessible name.
    const toc = screen.getByRole('navigation', { name: /contents|目次/i });
    expect(toc).toBeInTheDocument();
    // Each TOC entry is an anchor that points at one of the section ids.
    const expectedHrefs = ['#sec1', '#sec2', '#sec3', '#sec4', '#sec5', '#references'];
    for (const href of expectedHrefs) {
      const link = toc.querySelector(`a[href="${href}"]`);
      expect(link, `TOC link to ${href} should exist`).not.toBeNull();
    }
  });

  it('renders six displayed equations via the (mocked) BlockMath component', () => {
    render(<DetailsPage onBack={() => {}} />);
    // Wheeler ε_eff, Wheeler Z₀, HJ ε_eff, BVP, weak form, energy → C/Z₀/ε_eff.
    // §3-§5 add prose and plots but no new displayed equations.
    expect(screen.getAllByTestId('block-math')).toHaveLength(6);
  });

  it('renders inline citation markers as superscript anchors', () => {
    render(<DetailsPage onBack={() => {}} />);
    // Several citations appear more than once (Wheeler [1] shows up in
    // both §1.1 and §1.3, etc.), so use getAllByRole and assert each
    // instance points to the right `#ref-N`.
    const refOne = screen.getAllByRole('link', { name: /reference 1/i });
    expect(refOne.length).toBeGreaterThan(0);
    for (const a of refOne) expect(a).toHaveAttribute('href', '#ref-1');
    const refSix = screen.getAllByRole('link', { name: /reference 6/i });
    expect(refSix.length).toBeGreaterThan(0);
    for (const a of refSix) expect(a).toHaveAttribute('href', '#ref-6');
  });

  it('calls onBack when the back button is clicked', () => {
    const onBack = vi.fn();
    render(<DetailsPage onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back|戻る/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
