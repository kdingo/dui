import { FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { api, setCsrfToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Flash } from '../components/Flash'
import { LanguageSelect } from '../components/LanguageSelect'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { errorMessage } from '../i18n/apiError'
import { POP_SPRING } from '../lib/motion'

export function LoginPage() {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string; expired?: boolean } | null
  const { setUser } = useAuth()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const result = await api.login(username, password)
      setCsrfToken(result.csrf_token)
      setUser({
        username: result.username,
        role: result.role as 'admin' | 'viewer',
        must_change_password: result.must_change_password,
      })
      navigate(state?.from || '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err, t('login.failed')))
    }
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
        <h2>DHCP UI</h2>
        <p className="muted">{t('login.subtitle')}</p>
        <Flash kind="error" message={state?.expired ? t('login.expired') : ''} />
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            {t('login.username')}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            {t('login.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="primary" type="submit">
            {t('login.submit')}
          </button>
          <Flash kind="error" message={error} />
        </form>
      </motion.div>
    </div>
  )
}
