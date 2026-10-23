/**
 * i18next initialisation for Cosmic Detective.
 *
 * Uses the resolveJsonModule tsconfig option (already true) to import JSON
 * locale files directly. Each language gets its own JSON file in
 * src/i18n/locales/ whose filename is the language code (e.g. en.json).
 *
 * The `resources` object format is required by i18next when using JSON imports:
 *   resources: {
 *     en: { translation: en },
 *     'zh-Hans': { translation: zhHans },
 *     ...
 *   }
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { LangCode } from './languages'
import { resolveInitialLang, LANGS, STORAGE_KEY } from './languages'
import en from './locales/en.json'
import bn from './locales/bn.json'
import zhHans from './locales/zh-Hans.json'
import es419 from './locales/es-419.json'
import ptBR from './locales/pt-BR.json'
import ar from './locales/ar.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    bn: { translation: bn },
    'zh-Hans': { translation: zhHans },
    'es-419': { translation: es419 },
    'pt-BR': { translation: ptBR },
    ar: { translation: ar },
  },
  lng: resolveInitialLang(),
  fallbackLng: 'en' as LangCode,
  react: { useSuspense: false },
  interpolation: { escapeValue: false }, // React already escapes
})

/** Keep <html lang> in sync (screen readers pick their voice from lang). */
function applyDocumentLang(code: LangCode) {
  const l = LANGS.find((l) => l.code === code) ?? LANGS[0]
  document.documentElement.lang = l.code
  document.documentElement.dir = 'ltr'
  try { localStorage.setItem(STORAGE_KEY, l.code) } catch { /* ignore */ }
}
applyDocumentLang(i18n.language as LangCode)
i18n.on('languageChanged', (code: string) => applyDocumentLang(code as LangCode))

export default i18n