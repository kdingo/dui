import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setCsrfToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { setUser } = useAuth()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const result = await api.login(username, password)
      setCsrfToken(result.csrf_token)
      setUser({ username: result.username, role: result.role as 'admin' | 'viewer' })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <h2>DHCP UI (DUI)</h2>
        <p className="muted">Sign in to manage your DHCP server.</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
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
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  )
}
