import i18n from 'i18next'

function locale() {
  return i18n.resolvedLanguage || i18n.language
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale()).format(value)
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

/** "30 seconds", "5 minutes", ... in the current language. */
export function formatDuration(ms: number): string {
  const [value, unit] = ms % 60000 === 0 ? [ms / 60000, 'minute'] : [ms / 1000, 'second']
  return new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}
