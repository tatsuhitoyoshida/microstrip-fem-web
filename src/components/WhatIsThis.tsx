/**
 * Static intro banner shown between the header and the main grid. Tells
 * first-time visitors what the tool is, what makes it different from
 * closed-form calculators, and how to use it. Always visible — no toggle.
 *
 * Spans the same `max-width` as `.app__main` (1400px) so it visually lines
 * up with the parameters / heatmap row below.
 *
 * The "more details" trigger used to open the GitHub README in a new tab
 * (placeholder while the in-app explainer was missing). It now navigates
 * to the in-app `DetailsPage` via the `onShowDetails` callback the parent
 * provides — so we render it as a button styled like a link rather than
 * an `<a>` element.
 */

import { Trans, useTranslation } from 'react-i18next';

export interface WhatIsThisProps {
  /** Open the in-app details / explainer page. Wired in `App.tsx` to
   *  switch the top-level `view` state to `'details'`. */
  onShowDetails: () => void;
}

export function WhatIsThis(props: WhatIsThisProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="what-is-this" aria-label={t('whatIs.title')}>
      <h2>{t('whatIs.title')}</h2>
      <p>{t('whatIs.intro')}</p>
      <p>{t('whatIs.accuracy')}</p>
      <p>{t('whatIs.usage')}</p>
      <p>
        <Trans
          i18nKey="whatIs.local"
          components={{
            // Tag name must NOT collide with a real HTML element — i18next's
            // Trans parser otherwise gets confused. Hence `detail` rather
            // than `link` (HTML <link> is a stylesheet element).
            detail: (
              <button
                type="button"
                className="what-is-this__detail-link"
                onClick={props.onShowDetails}
              />
            ),
          }}
        />
      </p>
    </section>
  );
}
