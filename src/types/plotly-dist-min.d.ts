/**
 * `plotly.js-dist-min` re-exports the same surface as `plotly.js`, but ships
 * no types of its own. Forward the declarations from `@types/plotly.js`.
 */
declare module 'plotly.js-dist-min' {
  import Plotly from 'plotly.js';
  export = Plotly;
}
