import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/translation.json'
import { DEFAULT_LANGUAGE, LANGUAGES } from './languages'

export const LANGUAGE_STORAGE_KEY = 'dui-lang'

// One lazily loaded chunk per locale; English is bundled above so it never has to wait.
const localeLoaders = import.meta.glob<ResourceKey>('../locales/*/translation.json', { import: 'default' })

const lazyLocales: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, _namespace, callback) {
    const load = localeLoaders[`../locales/${language}/translation.json`]
    if (!load) {
      callback(null, {})
      return
    }
    load().then(
      (resources) => callback(null, resources),
      (error: Error) => callback(error, null),
    )
  },
}

function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language
  document.documentElement.dir = i18n.dir(language)
}

i18n.on('languageChanged', applyDocumentLanguage)

/** Resolves once the detected language is loaded, so the first render is already translated. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { [DEFAULT_LANGUAGE]: { translation: en } },
    partialBundledLanguages: true,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((language) => language.code),
    nonExplicitSupportedLngs: true,
    load: 'currentOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false }, // React escapes rendered text
    react: { useSuspense: false },
    returnNull: false,
  })

export default i18n
