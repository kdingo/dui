import { Fragment, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'

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
  const confirm = useConfirm()

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
    if (!isAdmin) return
    const confirmed = await confirm({
      title: 'Restore this snapshot?',
      message: `The current configuration will be replaced with snapshot ${id}.`,
      confirmLabel: 'Restore',
    })
    if (!confirmed) return
    try {
      await api.restoreSnapshot(id)
      setMessage(`Restored snapshot ${id}.`)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  async function remove(id: string) {
    if (!isAdmin) return
    const confirmed = await confirm({
      title: 'Delete this snapshot?',
      message: `Snapshot ${id} will be permanently removed.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return
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
      <Flash kind="error" message={error} />
      <Flash message={message} />
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
                    <td className="actions">
                      <button
                        className="secondary"
                        disabled={!snapshot.has_dhcpd_conf}
                        onClick={() => toggleView(snapshot)}
                      >
                        View
                      </button>
                      <button className="secondary" onClick={() => restore(snapshot.id)}>
                        Restore
                      </button>
                      <button className="danger" onClick={() => remove(snapshot.id)}>
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
                        className="mono"
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
