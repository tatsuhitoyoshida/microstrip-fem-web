/**
 * Header-level JA / EN toggle.
 *
 * On click, the switcher updates the URL path (`/ja/` or `/en/`) via
 * `history.pushState`, then asks i18next to change language. The detector
 * also persists the choice to localStorage so a return visit lands on the
 * same language regardless of URL.
 */

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';

function setUrlLanguagePrefix(lang: Language): void {
  const url = new URL(window.location.href);
  // Replace any existing /xx/ prefix or insert one at the root.
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && (SUPPORTED_LANGUAGES as readonly string[]).includes(segments[0]!)) {
    segments[0] = lang;
  } else {
    segments.unshift(lang);
  }
  url.pathname = '/' + segments.join('/') + (url.pathname.endsWith('/') ? '/' : '');
  window.history.replaceState(null, '', url.toString());
}

export function LanguageSwitcher(): React.ReactElement {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0] as Language;

  const handleChange = (lang: Language): void => {
    if (lang === current) return;
    setUrlLanguagePrefix(lang);
    void i18n.changeLanguage(lang);
  };

  return (
    <div className="language-switcher" role="group" aria-label={t('language.switcher')}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={`language-switcher__btn${
            lang === current ? ' language-switcher__btn--active' : ''
          }`}
          onClick={() => handleChange(lang)}
          aria-pressed={lang === current}
        >
          {t(`language.${lang}`)}
        </button>
      ))}
    </div>
  );
}
