import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function SnapshotsPage() {
  const { isAdmin } = useAuth()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    const data = await api.snapshots()
    setSnapshots(data.snapshots)
  }

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [])

  async function restore(id: string) {
    if (!isAdmin || !window.confirm(`Restore snapshot ${id}?`)) return
    try {
      await api.restoreSnapshot(id)
      setMessage(`Restored snapshot ${id}.`)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  return (
    <div>
      <h2>Config snapshots</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Config JSON</th>
              <th>dhcpd.conf</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snapshot) => (
              <tr key={snapshot.id}>
                <td>{snapshot.id}</td>
                <td>{snapshot.has_config_json ? 'yes' : 'no'}</td>
                <td>{snapshot.has_dhcpd_conf ? 'yes' : 'no'}</td>
                {isAdmin && (
                  <td>
                    <button className="secondary" onClick={() => restore(snapshot.id)}>
                      Restore
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!snapshots.length && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3}>No snapshots yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
