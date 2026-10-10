import i18n from 'i18next'
import { ApiError, type ApiErrorBody, type ApiErrorItem } from '../api/client'

type Params = Record<string, unknown>

// Keys here come from the server at runtime, so they bypass the compile-time key check.
const translate = i18n.t.bind(i18n) as unknown as (key: string, options?: Params) => string

function isCodedEntry(value: unknown): value is { code: string; params?: Params } {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string'
}

/** Params that are lists of `{code, params}` (e.g. a list of nested problems) become a translated list. */
function translateParams(params: Params): Params {
  const result: Params = {}
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value) && value.length && value.every(isCodedEntry)) {
      const parts = value.map((entry) => translateCode(entry.code, entry.params ?? {}) ?? entry.code)
      result[name] = new Intl.ListFormat(i18n.resolvedLanguage, { type: 'conjunction' }).format(parts)
    } else {
      result[name] = value
    }
  }
  return result
}

function translateCode(code: string, params: Params): string | undefined {
  const key = `server.${code}`
  return i18n.exists(key) ? translate(key, translateParams(params)) : undefined
}

function fieldLabel(loc: (string | number)[] = []): string | undefined {
  const names = loc.filter((part): part is string => typeof part === 'string' && part !== 'body')
  const last = names[names.length - 1]
  return last ? translate(`fields.${last}`, { defaultValue: last }) : undefined
}

function translateItem(item: ApiErrorItem): string {
  const type = item.type ?? ''
  // Our own codes are dotted ("validation.mac"); pydantic's built-in types are not ("missing").
  const key = type.includes('.') ? `server.${type}` : `validation.${type}`
  const message = type && i18n.exists(key) ? translate(key, translateParams(item.ctx ?? {})) : (item.msg ?? '')
  const field = fieldLabel(item.loc)
  return field ? translate('errors.field', { field, message }) : message
}

function translateItems(items: ApiErrorItem[]): string {
  return items.map(translateItem).join(translate('errors.separator'))
}

function translateBody(body: ApiErrorBody, fallback: string): string {
  if (Array.isArray(body.detail)) return translateItems(body.detail)
  if (!body.code) return fallback
  const params: Params = { ...body.params }
  if (body.errors) params.errors = translateItems(body.errors)
  if (body.cause) params.reason = translateBody(body.cause, String(params.reason ?? ''))
  return translateCode(body.code, params) ?? fallback
}

/**
 * A user-facing message for a caught error, translated when the server sent a known code.
 * Anything else (e.g. the browser's own "Failed to fetch") becomes the translated `fallback`.
 */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? translateBody(err.body, err.message || fallback) : fallback
}
