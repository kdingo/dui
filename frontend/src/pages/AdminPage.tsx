import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpStatus, ServerInfo } from '../api/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'

export function AdminPage() {
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<DhcpStatus | null>(null)
  const [serverName, setServerName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const confirm = useConfirm()

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
