import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpStatus, ServerInfo } from '../api/types'

export function AdminPage() {
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<DhcpStatus | null>(null)
  const [serverName, setServerName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    const [serverInfo, dhcpStatus] = await Promise.all([api.serverInfo(), api.dhcpStatus()])
    setServer(serverInfo)
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

  async function dhcpAction(action: 'start' | 'stop' | 'restart') {
    await api.dhcpControl(action)
    setMessage(`DHCP service ${action} requested.`)
    await refresh()
  }

  async function containerAction(action: 'stop' | 'restart') {
    if (!window.confirm(`Really ${action} the container?`)) return
    if (action === 'stop') await api.containerStop()
    else await api.containerRestart()
  }

  return (
    <div>
      <h2>Server admin</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}

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
          <h3>DHCP service</h3>
          <p>{status?.running ? 'Running' : 'Stopped'}</p>
          <p className="muted">{status?.detail}</p>
          <div className="actions">
            <button className="secondary" onClick={() => dhcpAction('start')}>
              Start
            </button>
            <button className="secondary" onClick={() => dhcpAction('stop')}>
              Stop
            </button>
            <button className="secondary" onClick={() => dhcpAction('restart')}>
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
