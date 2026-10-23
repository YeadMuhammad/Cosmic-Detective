/**
 * Language definitions and initialisation logic for i18next.
 * Keeps <html lang> and document.dir in sync for screen readers (Arabic needs rtl).
 *
 * @typeParam LangCode - string literal union of supported language codes
 */

/** Language code union type. */
export type LangCode = 'en' | 'bn' | 'zh-Hans' | 'es-419' | 'pt-BR' | 'ar'

/** Default language if none is saved or recognized. */
export const DEFAULT_LANG: LangCode = 'en'

/** LocalStorage key for persisted language choice. */
export const STORAGE_KEY = 'cosmic-detective:lang'

/** All supported languages with native names and text direction. */
export const LANGS = [
  { code: 'en', native: 'English', dir: 'ltr' },
  { code: 'bn', native: 'বাংলা', dir: 'ltr' },
  { code: 'zh-Hans', native: '简体中文', dir: 'ltr' },
  { code: 'es-419', native: 'Español', dir: 'ltr' },
  { code: 'pt-BR', native: 'Português', dir: 'ltr' },
  { code: 'ar', native: 'العربية', dir: 'rtl' },
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
    if (saved === 'en' || saved === 'bn' || saved === 'zh-Hans' || saved === 'es-419' || saved === 'pt-BR' || saved === 'ar') return saved as LangCode
  } catch { /* storage unavailable */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('bn')) return 'bn'
  if (nav.startsWith('zh')) return 'zh-Hans'
  if (nav.startsWith('es')) return 'es-419'
  if (nav.startsWith('pt')) return 'pt-BR'
  if (nav.startsWith('ar')) return 'ar'
  return DEFAULT_LANG
}