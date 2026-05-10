/**
 * Static intro banner shown between the header and the main grid. Tells
 * first-time visitors what the tool is, what makes it different from
 * closed-form calculators, and how to use it. Always visible — no toggle.
 *
 * Spans the same `max-width` as `.app__main` (1400px) so it visually lines
 * up with the parameters / heatmap row below.
 */

import { Trans, useTranslation } from 'react-i18next';

// TODO: replace with the future detail page (e.g. `/docs`) once Tatsy
// publishes it. Pointing at the GitHub repo's README in the meantime —
// it carries the most detailed theory / validation content we currently
// have, and clicking it doesn't 404.
const DETAIL_LINK_HREF = 'https://github.com/photonic-edge/microstrip-fem-web#readme';

export function WhatIsThis(): React.ReactElement {
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
              <a
                className="what-is-this__detail-link"
                href={DETAIL_LINK_HREF}
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
        />
      </p>
    </section>
  );
}
