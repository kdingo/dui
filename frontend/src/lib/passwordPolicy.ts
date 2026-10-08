import type { TFunction } from 'i18next'
import type { PasswordPolicy } from '../api/types'

export const DEFAULT_POLICY: PasswordPolicy = {
  min_length: 8,
  require_lowercase: false,
  require_uppercase: false,
  require_digit: false,
  require_symbol: false,
  disallow_username: true,
}

export const POLICY_MIN_LENGTH_FLOOR = 8
export const POLICY_MAX_LENGTH = 72

export interface Requirement {
  id: string
  label: string
  met: boolean
}

/** Mirrors PasswordPolicy.problem_codes() in backend/app/auth/policy.py; the server stays authoritative. */
export function passwordRequirements(
  t: TFunction,
  policy: PasswordPolicy,
  password: string,
  username?: string,
): Requirement[] {
  const list: Requirement[] = [
    {
      id: 'min_length',
      label: t('password.requirements.minLength', { min: policy.min_length }),
      met: password.length >= policy.min_length,
    },
  ]
  if (policy.require_lowercase) {
    list.push({ id: 'lowercase', label: t('password.requirements.lowercase'), met: /\p{Ll}/u.test(password) })
  }
  if (policy.require_uppercase) {
    list.push({ id: 'uppercase', label: t('password.requirements.uppercase'), met: /\p{Lu}/u.test(password) })
  }
  if (policy.require_digit) {
    list.push({ id: 'digit', label: t('password.requirements.digit'), met: /\p{Nd}/u.test(password) })
  }
  if (policy.require_symbol) {
    list.push({ id: 'symbol', label: t('password.requirements.symbol'), met: /[^\p{L}\p{N}]/u.test(password) })
  }
  if (policy.disallow_username && username) {
    list.push({
      id: 'no_username',
      label: t('password.requirements.noUsername'),
      met: !password.toLowerCase().includes(username.toLowerCase()),
    })
  }
  if (new TextEncoder().encode(password).length > POLICY_MAX_LENGTH) {
    list.push({ id: 'max_bytes', label: t('password.requirements.maxBytes', { max: POLICY_MAX_LENGTH }), met: false })
  }
  return list
}
