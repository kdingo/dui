import { FormEvent, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { api, setCsrfToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Flash } from '../components/Flash'
import { LanguageSelect } from '../components/LanguageSelect'
import { Logo } from '../components/Logo'
import { PasswordRequirements } from '../components/PasswordRequirements'
import { ThemeToggle } from '../components/ThemeToggle'
import { errorMessage } from '../i18n/apiError'
import { POP_SPRING } from '../lib/motion'
import { DEFAULT_POLICY, passwordRequirements } from '../lib/passwordPolicy'

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [policy, setPolicy] = useState(DEFAULT_POLICY)
  const requirements = passwordRequirements(t, policy, next, user?.username)

  useEffect(() => {
    api
      .passwordPolicy()
      .then(setPolicy)
      .catch(() => undefined)
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (requirements.some((req) => !req.met)) {
      setError(t('password.notMet'))
      return
    }
    if (next !== confirm) {
      setError(t('password.mismatch'))
      return
    }
    try {
      const result = await api.changePassword(current, next)
      setCsrfToken(result.csrf_token)
      setCurrent('')
      setNext('')
      setConfirm('')
      if (user) setUser({ ...user, must_change_password: false })
      if (!forced) setSuccess(t('password.changed'))
    } catch (err) {
      setError(errorMessage(err, t('password.failed')))
    }
  }

  const form = (
    <form className="form-grid" onSubmit={handleSubmit}>
      <input type="text" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <label>
        {t('password.current')}
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        {t('password.new')}
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={policy.min_length}
          required
        />
      </label>
      <PasswordRequirements requirements={requirements} />
      <label>
        {t('password.confirm')}
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <button className="primary" type="submit">
        {t('password.submit')}
      </button>
      <Flash kind="error" message={error} />
      <Flash kind="success" message={success} />
    </form>
  )

  if (!forced) {
    return (
      <div className="card">
        <h2>{t('password.title')}</h2>
        {form}
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="floating-controls">
        <LanguageSelect />
        <ThemeToggle />
      </div>
      <motion.div
        className="card login-card"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={POP_SPRING}
      >
        <Logo size={56} fill="once" className="login-logo" />
        <h2>{t('password.forcedTitle')}</h2>
        <p className="muted">{t('password.forcedSubtitle')}</p>
        {form}
      </motion.div>
    </div>
  )
}
