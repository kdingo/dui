import type { Requirement } from '../lib/passwordPolicy'

/** Live checklist of the password policy for a password field. */
export function PasswordRequirements({ requirements }: { requirements: Requirement[] }) {
  return (
    <ul className="password-requirements" aria-label="Password requirements">
      {requirements.map((req) => (
        <li key={req.label} className={req.met ? 'met' : ''}>
          <span aria-hidden="true">{req.met ? '✓' : '•'}</span> {req.label}
          <span className="visually-hidden">{req.met ? ' (met)' : ' (not met)'}</span>
        </li>
      ))}
    </ul>
  )
}
