/**
 * Languages the UI offers. To add one:
 *   1. Copy src/locales/en/translation.json to src/locales/<code>/translation.json and translate the values.
 *   2. Add an entry below (`code` is a BCP 47 tag such as 'de' or 'pt-BR'; `name` is the language's own name).
 *   3. Run `npm run i18n:check` to list missing or extra keys.
 * Text direction (e.g. right-to-left for Arabic or Hebrew) is derived from the code.
 */
export interface Language {
  code: string
  name: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English' },
]

/** Source language: always bundled, and the fallback for any missing translation. */
export const DEFAULT_LANGUAGE = 'en'
