/**
 * Static "About" panel: motivation, attribution, license, and links.
 * Toggled by a button on the parameter form.
 */

import { Trans, useTranslation } from 'react-i18next';

export function About(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="about">
      <h2>{t('about.title')}</h2>

      <h3>{t('about.whyFemTitle')}</h3>
      <p>{t('about.whyFemBody')}</p>

      <h3>{t('about.scopeTitle')}</h3>
      <ul>
        <li>{t('about.scope1')}</li>
        <li>{t('about.scope2')}</li>
        <li>{t('about.scope3')}</li>
      </ul>

      <h3>{t('about.licenseTitle')}</h3>
      <p>
        <Trans
          i18nKey="about.licenseBody"
          components={{
            github: (
              <a
                href="https://github.com/photonic-edge/microstrip-fem-web"
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
        />
      </p>

      <p className="about__credit">
        <Trans
          i18nKey="about.credit"
          components={{
            pe: <a href="https://photonic-edge.com" target="_blank" rel="noreferrer" />,
          }}
        />
      </p>
    </section>
  );
}
