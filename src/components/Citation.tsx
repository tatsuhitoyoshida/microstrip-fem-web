/**
 * Inline citation marker: renders `[n]` as a superscript anchor link
 * to the corresponding entry in the references list. Used inside the
 * DetailsPage prose to attach bibliography pointers to specific
 * claims.
 *
 * Smooth-scroll behaviour comes from the global `html { scroll-behavior:
 * smooth }` rule in `App.css` — we don't touch the browser focus ring
 * here so keyboard users keep their normal tab-navigation cues.
 */

export interface CitationProps {
  /** 1-based reference number; must match a `<li id="ref-{n}">` in the
   *  page's bibliography list. */
  n: number;
}

export function Citation({ n }: CitationProps): React.ReactElement {
  return (
    <sup className="citation">
      <a href={`#ref-${n}`} aria-label={`Reference ${n}`}>
        [{n}]
      </a>
    </sup>
  );
}
