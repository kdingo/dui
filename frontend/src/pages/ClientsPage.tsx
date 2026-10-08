import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { DhcpConfig, DhcpHost } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../i18n/apiError'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'

const emptyHost = {
  name: '',
  hardware_address: '',
  fixed_address: '',
  options: {},
}

export function ClientsPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [form, setForm] = useState(emptyHost)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  useEffect(() => {
    api.getConfig().then(setConfig).catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin) return
    setError('')
    try {
      const updated = editingId ? await api.updateHost(editingId, form) : await api.addHost(form)
      setConfig(updated)
      setForm(emptyHost)
      setEditingId(null)
    } catch (err) {
      setError(errorMessage(err, t('common.saveFailed')))
    }
  }

  function startEdit(host: DhcpHost) {
    setEditingId(host.id)
    setForm({
      name: host.name,
      hardware_address: host.hardware_address,
      fixed_address: host.fixed_address,
      options: host.options,
    })
  }

  async function removeHost(id: string) {
    if (!isAdmin) return
    const confirmed = await confirm({
      title: t('clients.deleteTitle'),
      message: t('clients.deleteMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!confirmed) return
    try {
      setConfig(await api.deleteHost(id))
    } catch (err) {
      setError(errorMessage(err, t('common.deleteFailed')))
    }
  }

  return (
    <div>
      <h2>{t('clients.title')}</h2>
      <Flash kind="error" message={error} />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('clients.mac')}</th>
              <th>{t('clients.fixedIp')}</th>
              {isAdmin && <th>{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {config?.hosts.map((host) => (
              <tr key={host.id}>
                <td>{host.name}</td>
                <td>{host.hardware_address}</td>
                <td>{host.fixed_address}</td>
                {isAdmin && (
                  <td className="actions">
                    <button className="secondary" onClick={() => startEdit(host)}>
                      {t('common.edit')}
                    </button>
                    <button className="danger" onClick={() => removeHost(host.id)}>
                      {t('common.delete')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!config?.hosts.length && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3}>{t('clients.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <h3>{editingId ? t('clients.editTitle') : t('clients.addTitle')}</h3>
          <label>
            {t('common.name')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            {t('clients.macAddress')}
            <input
              value={form.hardware_address}
              onChange={(e) => setForm({ ...form, hardware_address: e.target.value })}
              required
            />
          </label>
          <label>
            {t('clients.fixedIp')}
            <input
              value={form.fixed_address}
              onChange={(e) => setForm({ ...form, fixed_address: e.target.value })}
              required
            />
          </label>
          <button className="primary" type="submit">
            {t('clients.save')}
          </button>
        </form>
      )}
    </div>
  )
}
