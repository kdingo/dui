import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n/languages'

/** Picks the UI language; hidden until more than one language is listed in i18n/languages.ts. */
export function LanguageSelect() {
  const { t, i18n } = useTranslation()
  if (LANGUAGES.length < 2) return null

  return (
    <select
      className="language-select"
      value={i18n.resolvedLanguage}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
      aria-label={t('language.label')}
      title={t('language.label')}
    >
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code} lang={language.code}>
          {language.name}
        </option>
      ))}
    </select>
  )
}
