import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { errorMessage } from '../i18n/apiError'
import { formatDateTime } from '../i18n/format'

function formatSnapshotDate(createdAt: string): string {
  const match = createdAt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!match) return createdAt
  const [, y, m, d, h, min, s] = match
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`)
  if (Number.isNaN(date.getTime())) return createdAt
  return formatDateTime(date)
}

export function SnapshotsPage() {
  const { t } = useTranslation()
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
    load().catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
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
      setError(errorMessage(err, t('snapshots.loadConfFailed')))
    }
  }

  async function restore(id: string) {
    if (!isAdmin) return
    const confirmed = await confirm({
      title: t('snapshots.restoreTitle'),
      message: t('snapshots.restoreMessage', { id }),
      confirmLabel: t('snapshots.restore'),
    })
    if (!confirmed) return
    try {
      await api.restoreSnapshot(id)
      setMessage(t('snapshots.restored', { id }))
      setError('')
    } catch (err) {
      setError(errorMessage(err, t('snapshots.restoreFailed')))
    }
  }

  async function remove(id: string) {
    if (!isAdmin) return
    const confirmed = await confirm({
      title: t('snapshots.deleteTitle'),
      message: t('snapshots.deleteMessage', { id }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await api.deleteSnapshot(id)
      setMessage(t('snapshots.deleted', { id }))
      setError('')
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await load()
    } catch (err) {
      setError(errorMessage(err, t('common.deleteFailed')))
    }
  }

  const colSpan = isAdmin ? 3 : 2

  return (
    <div>
      <h2>{t('snapshots.title')}</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t('snapshots.date')}</th>
              <th>{t('snapshots.id')}</th>
              {isAdmin && <th>{t('common.actions')}</th>}
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
                        {t('snapshots.view')}
                      </button>
                      <button className="secondary" onClick={() => restore(snapshot.id)}>
                        {t('snapshots.restore')}
                      </button>
                      <button className="danger" onClick={() => remove(snapshot.id)}>
                        {t('common.delete')}
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
                <td colSpan={colSpan}>{t('snapshots.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
