import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpConfig, DhcpHost } from '../api/types'
import { useAuth } from '../auth/AuthContext'

const emptyHost = {
  name: '',
  hardware_address: '',
  fixed_address: '',
  options: {},
}

export function ClientsPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [form, setForm] = useState(emptyHost)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getConfig().then(setConfig).catch((err) => setError(err.message))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin) return
    try {
      const updated = editingId ? await api.updateHost(editingId, form) : await api.addHost(form)
      setConfig(updated)
      setForm(emptyHost)
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
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
    if (!isAdmin || !window.confirm('Delete this client reservation?')) return
    setConfig(await api.deleteHost(id))
  }

  return (
    <div>
      <h2>DHCP clients</h2>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>MAC</th>
              <th>Fixed IP</th>
              {isAdmin && <th>Actions</th>}
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
                      Edit
                    </button>
                    <button className="danger" onClick={() => removeHost(host.id)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!config?.hosts.length && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3}>No fixed clients configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <h3>{editingId ? 'Edit client' : 'Add client'}</h3>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            MAC address
            <input
              value={form.hardware_address}
              onChange={(e) => setForm({ ...form, hardware_address: e.target.value })}
              required
            />
          </label>
          <label>
            Fixed IP
            <input
              value={form.fixed_address}
              onChange={(e) => setForm({ ...form, fixed_address: e.target.value })}
              required
            />
          </label>
          <button className="primary" type="submit">
            Save client
          </button>
        </form>
      )}
    </div>
  )
}
