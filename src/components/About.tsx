/**
 * Static "About" panel: motivation, attribution, license, and links.
 * Toggled by a button on the parameter form.
 */

export function About(): React.ReactElement {
  return (
    <section className="about">
      <h2>About this tool</h2>

      <h3>Why FEM?</h3>
      <p>
        Most online microstrip calculators rely on Hammerstad–Jensen or Wheeler closed-form
        approximations. Those formulas drift as conductor thickness grows, the h/W ratio shrinks, or
        frequency rises. This tool runs a true 2-D quasi-static finite-element method (FEM) directly
        in the browser, giving rigorous Z₀ values that hold up where the closed-form expressions
        break down.
      </p>

      <h3>v0.1 scope</h3>
      <ul>
        <li>Single-ended microstrip only (no differential / CPW / stripline)</li>
        <li>Quasi-static, lossless (no tan δ, skin effect, or dispersion yet)</li>
        <li>Single-layer substrate</li>
      </ul>

      <h3>License & source</h3>
      <p>
        MIT licensed. Source on{' '}
        <a
          href="https://github.com/photonic-edge/microstrip-fem-web"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        .
      </p>

      <p className="about__credit">
        Built by{' '}
        <a href="https://photonic-edge.com" target="_blank" rel="noreferrer">
          Photonic Edge Inc.
        </a>
      </p>
    </section>
  );
}
