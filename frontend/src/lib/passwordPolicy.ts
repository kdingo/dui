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
  label: string
  met: boolean
}

/** Mirrors PasswordPolicy.problems() in backend/app/auth/policy.py; the server stays authoritative. */
export function passwordRequirements(policy: PasswordPolicy, password: string, username?: string): Requirement[] {
  const list: Requirement[] = [
    { label: `At least ${policy.min_length} characters`, met: password.length >= policy.min_length },
  ]
  if (policy.require_lowercase) list.push({ label: 'A lowercase letter', met: /\p{Ll}/u.test(password) })
  if (policy.require_uppercase) list.push({ label: 'An uppercase letter', met: /\p{Lu}/u.test(password) })
  if (policy.require_digit) list.push({ label: 'A digit', met: /\p{Nd}/u.test(password) })
  if (policy.require_symbol) list.push({ label: 'A symbol', met: /[^\p{L}\p{N}]/u.test(password) })
  if (policy.disallow_username && username) {
    list.push({
      label: 'Does not contain the username',
      met: !password.toLowerCase().includes(username.toLowerCase()),
    })
  }
  if (new TextEncoder().encode(password).length > POLICY_MAX_LENGTH) {
    list.push({ label: `At most ${POLICY_MAX_LENGTH} bytes`, met: false })
  }
  return list
}
