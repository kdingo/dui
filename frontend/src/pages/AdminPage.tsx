import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpStatus, PasswordPolicy, ServerInfo } from '../api/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { DEFAULT_POLICY, POLICY_MAX_LENGTH, POLICY_MIN_LENGTH_FLOOR } from '../lib/passwordPolicy'

const POLICY_RULES: { key: keyof Omit<PasswordPolicy, 'min_length'>; label: string }[] = [
  { key: 'require_lowercase', label: 'Require a lowercase letter' },
  { key: 'require_uppercase', label: 'Require an uppercase letter' },
  { key: 'require_digit', label: 'Require a digit' },
  { key: 'require_symbol', label: 'Require a symbol' },
  { key: 'disallow_username', label: 'Reject passwords containing the username' },
]

export function AdminPage() {
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<DhcpStatus | null>(null)
  const [serverName, setServerName] = useState('')
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const confirm = useConfirm()

  async function refresh() {
    const [serverInfo, dhcpStatus, passwordPolicy] = await Promise.all([
      api.serverInfo(),
      api.dhcpStatus(),
      api.passwordPolicy(),
    ])
    setServer(serverInfo)
    setPolicy(passwordPolicy)
    setServerName(serverInfo.name)
    setStatus(dhcpStatus)
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message))
  }, [])

  async function saveServerName(event: FormEvent) {
    event.preventDefault()
    await api.updateServerName(serverName)
    setMessage('Server name updated.')
    await refresh()
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      setPolicy(await api.updatePasswordPolicy(policy))
      setMessage('Password policy saved. It applies to passwords set from now on.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the password policy failed')
    }
  }

  async function dhcpAction(action: 'start' | 'stop' | 'restart') {
    await api.dhcpControl(action)
    setMessage(`DHCP service ${action} requested.`)
    await refresh()
  }

  async function containerAction(action: 'stop' | 'restart') {
    const confirmed = await confirm({
      title: `${action === 'stop' ? 'Stop' : 'Restart'} the container?`,
      message:
        action === 'stop'
          ? 'The web UI and DHCP service will go offline until the container is started again.'
          : 'The web UI and DHCP service will be briefly unavailable.',
      confirmLabel: action === 'stop' ? 'Stop container' : 'Restart container',
      danger: action === 'stop',
    })
    if (!confirmed) return
    if (action === 'stop') await api.containerStop()
    else await api.containerRestart()
  }

  return (
    <div>
      <h2>Server admin</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />

      <div className="card-grid">
        <div className="card">
          <h3>Server</h3>
          <form className="form-grid" onSubmit={saveServerName}>
            <label>
              Display name
              <input value={serverName} onChange={(e) => setServerName(e.target.value)} />
            </label>
            <button className="primary" type="submit">
              Save name
            </button>
          </form>
          {server && (
            <p className="muted">
              Interface: {server.interface} · Port: {server.http_port}
            </p>
          )}
        </div>

        <div className="card">
          <h3>Password policy</h3>
          <form className="form-grid" onSubmit={savePolicy}>
            <label>
              Minimum length ({POLICY_MIN_LENGTH_FLOOR}–{POLICY_MAX_LENGTH})
              <input
                type="number"
                min={POLICY_MIN_LENGTH_FLOOR}
                max={POLICY_MAX_LENGTH}
                value={policy.min_length}
                onChange={(e) => setPolicy({ ...policy, min_length: Number(e.target.value) })}
                required
              />
            </label>
            {POLICY_RULES.map((rule) => (
              <label key={rule.key} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={policy[rule.key]}
                  onChange={(e) => setPolicy({ ...policy, [rule.key]: e.target.checked })}
                />
                {rule.label}
              </label>
            ))}
            <button className="primary" type="submit">
              Save policy
            </button>
          </form>
          <p className="muted">Existing passwords keep working; the policy is checked whenever a password is set.</p>
        </div>

        <div className="card">
          <h3>DHCP service</h3>
          <p>
            <span className={`status-dot ${status?.running ? 'on' : ''}`} aria-hidden="true" />
            {status?.running ? 'Running' : 'Stopped'}
          </p>
          <p className="muted">{status?.detail}</p>
          <div className="actions">
            <button className="secondary" disabled={Boolean(status?.running)} onClick={() => dhcpAction('start')}>
              Start
            </button>
            <button className="secondary" disabled={!status?.running} onClick={() => dhcpAction('stop')}>
              Stop
            </button>
            <button className="secondary" disabled={!status?.running} onClick={() => dhcpAction('restart')}>
              Restart
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Container</h3>
          <div className="actions">
            <button className="danger" onClick={() => containerAction('stop')}>
              Stop container
            </button>
            <button className="secondary" onClick={() => containerAction('restart')}>
              Restart container
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
