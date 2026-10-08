import 'i18next'
import type en from '../locales/en/translation.json'

// English is the source of truth for keys, so `t('typo')` is a type error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
