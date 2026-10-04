import { FormEvent, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { api, setCsrfToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Flash } from '../components/Flash'
import { Logo } from '../components/Logo'
import { PasswordRequirements } from '../components/PasswordRequirements'
import { ThemeToggle } from '../components/ThemeToggle'
import { POP_SPRING } from '../lib/motion'
import { DEFAULT_POLICY, passwordRequirements } from '../lib/passwordPolicy'

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { user, setUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [policy, setPolicy] = useState(DEFAULT_POLICY)
  const requirements = passwordRequirements(policy, next, user?.username)

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
      setError('New password does not meet the password requirements.')
      return
    }
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    try {
      const result = await api.changePassword(current, next)
      setCsrfToken(result.csrf_token)
      setCurrent('')
      setNext('')
      setConfirm('')
      if (user) setUser({ ...user, must_change_password: false })
      if (!forced) setSuccess('Password changed. Other sessions have been signed out.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed')
    }
  }

  const form = (
    <form className="form-grid" onSubmit={handleSubmit}>
      <input type="text" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <label>
        Current password
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        New password
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
        Confirm new password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <button className="primary" type="submit">
        Change password
      </button>
      <Flash kind="error" message={error} />
      <Flash kind="success" message={success} />
    </form>
  )

  if (!forced) {
    return (
      <div className="card">
        <h2>Change password</h2>
        {form}
      </div>
    )
  }

  return (
    <div className="login-page">
      <ThemeToggle className="floating-toggle" />
      <motion.div
        className="card login-card"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={POP_SPRING}
      >
        <Logo size={56} fill="once" className="login-logo" />
        <h2>Set a new password</h2>
        <p className="muted">You signed in with a one-time password. Choose your own to continue.</p>
        {form}
      </motion.div>
    </div>
  )
}
