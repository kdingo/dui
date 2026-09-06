import { Fragment, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { useAuth } from '../auth/AuthContext'

function formatSnapshotDate(createdAt: string): string {
  const match = createdAt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!match) return createdAt
  const [, y, m, d, h, min, s] = match
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`)
  if (Number.isNaN(date.getTime())) return createdAt
  return date.toLocaleString()
}

export function SnapshotsPage() {
  const { isAdmin } = useAuth()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState<Record<string, string>>({})

  async function load() {
    const data = await api.snapshots()
    setSnapshots(data.snapshots)
  }

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [])

  async function toggleView(snapshot: Snapshot) {
    if (!isAdmin || !snapshot.has_dhcpd_conf) return
    if (snapshot.id in expanded) {
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[snapshot.id]
        return next
      })
      return
    }
    try {
      const content = await api.snapshotDhcpdConf(snapshot.id)
      setExpanded((prev) => ({ ...prev, [snapshot.id]: content }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dhcpd.conf')
    }
  }

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

  async function remove(id: string) {
    if (!isAdmin || !window.confirm(`Delete snapshot ${id}?`)) return
    try {
      await api.deleteSnapshot(id)
      setMessage(`Deleted snapshot ${id}.`)
      setError('')
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const colSpan = isAdmin ? 3 : 2

  return (
    <div>
      <h2>Config snapshots</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>ID</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snapshot) => (
              <Fragment key={snapshot.id}>
                <tr>
                  <td>{formatSnapshotDate(snapshot.created_at)}</td>
                  <td>{snapshot.id}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="secondary"
                        disabled={!snapshot.has_dhcpd_conf}
                        onClick={() => toggleView(snapshot)}
                      >
                        View
                      </button>{' '}
                      <button className="secondary" onClick={() => restore(snapshot.id)}>
                        Restore
                      </button>{' '}
                      <button className="secondary" onClick={() => remove(snapshot.id)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
                {snapshot.id in expanded && (
                  <tr>
                    <td colSpan={colSpan}>
                      <textarea
                        readOnly
                        value={expanded[snapshot.id]}
                        rows={16}
                        style={{ width: '100%', fontFamily: 'monospace' }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!snapshots.length && (
              <tr>
                <td colSpan={colSpan}>No snapshots yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
