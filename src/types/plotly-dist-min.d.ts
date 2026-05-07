/**
 * `plotly.js-dist-min` re-exports the same surface as `plotly.js`, but ships
 * no types of its own. Forward the declarations from `@types/plotly.js`.
 *
 * Declared as `export default` (rather than `export =`) so dynamic
 * `await import(...)` gives `{ default: Plotly }` — which matches the
 * runtime shape Vite returns for the underlying CJS module.
 */
declare module 'plotly.js-dist-min' {
  import * as Plotly from 'plotly.js';
  export default Plotly;
}
