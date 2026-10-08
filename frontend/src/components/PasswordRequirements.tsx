import { useTranslation } from 'react-i18next'
import type { Requirement } from '../lib/passwordPolicy'

/** Live checklist of the password policy for a password field. */
export function PasswordRequirements({ requirements }: { requirements: Requirement[] }) {
  const { t } = useTranslation()
  return (
    <ul className="password-requirements" aria-label={t('password.requirements.label')}>
      {requirements.map((req) => (
        <li key={req.id} className={req.met ? 'met' : ''}>
          <span aria-hidden="true">{req.met ? '✓' : '•'}</span> {req.label}
          <span className="visually-hidden">
            {' '}
            {req.met ? t('password.requirements.met') : t('password.requirements.notMet')}
          </span>
        </li>
      ))}
    </ul>
  )
}
