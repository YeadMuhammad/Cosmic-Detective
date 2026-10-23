import { useTranslation } from 'react-i18next'
import { LANGS } from '../i18n/languages'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  return (
    <label className="lang-switch mono">
      <span className="sr-only">{t('lang.label')}</span>
      <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)} aria-label={t('lang.label')}>
        {LANGS.map((l) => (
          // each option is in its own language so screen readers pronounce it correctly
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>{l.native}</option>
        ))}
      </select>
    </label>
  )
}