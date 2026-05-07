/**
 * i18next configuration. Languages are detected, in order, from:
 *   1. URL path prefix      (/ja/..., /en/...)
 *   2. localStorage key     (set by the LanguageSwitcher on toggle)
 *   3. navigator.language   (browser default)
 *   4. fallback "en"
 *
 * Locale resources are statically imported so initialisation is synchronous
 * and the very first paint already has the correct copy.
 */

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ja from './locales/ja.json';

export const SUPPORTED_LANGUAGES = ['en', 'ja'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // Inspect URL path index 0 first (i.e. the segment right after `/`).
      order: ['path', 'localStorage', 'navigator', 'htmlTag'],
      lookupFromPathIndex: 0,
      caches: ['localStorage'],
    },
  });

/** Sync `<html lang>` whenever i18next switches languages. */
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
});

export default i18n;
