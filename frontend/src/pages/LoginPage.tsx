import { FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { api, setCsrfToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Flash } from '../components/Flash'
import { ThemeToggle } from '../components/ThemeToggle'
import { POP_SPRING } from '../lib/motion'

export function LoginPage() {
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
      setUser({ username: result.username, role: result.role as 'admin' | 'viewer' })
      navigate(state?.from || '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
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
        <div className="brand-mark" aria-hidden="true" />
        <h2>DHCP UI (DUI)</h2>
        <p className="muted">Sign in to manage your DHCP server.</p>
        <Flash kind="error" message={state?.expired ? 'Your session has expired. Please sign in again.' : ''} />
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="primary" type="submit">
            Login
          </button>
          <Flash kind="error" message={error} />
        </form>
      </motion.div>
    </div>
  )
}
