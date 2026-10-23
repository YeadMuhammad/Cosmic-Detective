/**
 * Language definitions and initialisation logic for i18next.
 * Keeps the document language in sync for screen readers. Layout stays LTR;
 * textDir is only used for individual language options.
 */

/** Language code union type. */
export type LangCode = 'en' | 'bn' | 'zh-Hans' | 'es-419' | 'pt-BR' | 'ar'

/** Default language if none is saved or recognized. */
export const DEFAULT_LANG: LangCode = 'en'

/** LocalStorage key for persisted language choice. */
export const STORAGE_KEY = 'cosmic-detective:lang'

/** All supported languages with native names and text direction. */
export const LANGS = [
  { code: 'en', native: 'English', textDir: 'ltr' },
  { code: 'bn', native: 'বাংলা', textDir: 'ltr' },
  { code: 'zh-Hans', native: '简体中文', textDir: 'ltr' },
  { code: 'es-419', native: 'Español', textDir: 'ltr' },
  { code: 'pt-BR', native: 'Português', textDir: 'ltr' },
  { code: 'ar', native: 'العربية', textDir: 'rtl' },
] as const

/**
 * Resolve the initial language:
 * 1. Saved user choice from localStorage
 * 2. Browser language mapped to our locales
 * 3. Fall back to English
 */
export function resolveInitialLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const savedLang = LANGS.find((lang) => lang.code === saved)
    if (savedLang) return savedLang.code
  } catch { /* storage unavailable */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('bn')) return 'bn'
  if (nav.startsWith('zh')) return 'zh-Hans'
  if (nav.startsWith('es')) return 'es-419'
  if (nav.startsWith('pt')) return 'pt-BR'
  if (nav.startsWith('ar')) return 'ar'
  return DEFAULT_LANG
}
