import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpConfig, DhcpSubnet } from '../api/types'
import { useAuth } from '../auth/AuthContext'

const emptySubnet = {
  network: '',
  netmask: '255.255.255.0',
  range: { start: '', end: '' },
  options: { routers: [''] },
}

export function NetworksPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [form, setForm] = useState(emptySubnet)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.getConfig().then(setConfig).catch((err) => setError(err.message))
  }, [])

  function resetForm() {
    setForm(emptySubnet)
    setEditingId(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin) return
    setError('')
    setMessage('')
    const payload = {
      network: form.network,
      netmask: form.netmask,
      range: form.range.start && form.range.end ? form.range : null,
      options: {
        routers: [(form.options.routers as string[])[0]].filter(Boolean),
      },
    }
    try {
      const updated = editingId ? await api.updateSubnet(editingId, payload) : await api.addSubnet(payload)
      setConfig(updated)
      setMessage(editingId ? 'Subnet updated.' : 'Subnet added.')
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  function startEdit(subnet: DhcpSubnet) {
    setEditingId(subnet.id)
    setForm({
      network: subnet.network,
      netmask: subnet.netmask,
      range: subnet.range || { start: '', end: '' },
      options: { routers: (subnet.options.routers as string[]) || [''] },
    })
  }

  async function removeSubnet(id: string) {
    if (!isAdmin || !window.confirm('Delete this subnet?')) return
    const updated = await api.deleteSubnet(id)
    setConfig(updated)
  }

  return (
    <div>
      <h2>Networks</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <table>
          <thead>
            <tr>
              <th>Network</th>
              <th>Netmask</th>
              <th>Range</th>
              <th>Router</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {config?.subnets.map((subnet) => (
              <tr key={subnet.id}>
                <td>{subnet.network}</td>
                <td>{subnet.netmask}</td>
                <td>
                  {subnet.range ? `${subnet.range.start} - ${subnet.range.end}` : '—'}
                </td>
                <td>{((subnet.options.routers as string[]) || []).join(', ') || '—'}</td>
                {isAdmin && (
                  <td className="actions">
                    <button className="secondary" onClick={() => startEdit(subnet)}>
                      Edit
                    </button>
                    <button className="danger" onClick={() => removeSubnet(subnet.id)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <h3>{editingId ? 'Edit subnet' : 'Add subnet'}</h3>
          <label>
            Network
            <input value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} required />
          </label>
          <label>
            Netmask
            <input value={form.netmask} onChange={(e) => setForm({ ...form, netmask: e.target.value })} required />
          </label>
          <label>
            Range start
            <input
              value={form.range.start}
              onChange={(e) => setForm({ ...form, range: { ...form.range, start: e.target.value } })}
            />
          </label>
          <label>
            Range end
            <input
              value={form.range.end}
              onChange={(e) => setForm({ ...form, range: { ...form.range, end: e.target.value } })}
            />
          </label>
          <label>
            Router
            <input
              value={(form.options.routers as string[])[0] || ''}
              onChange={(e) => setForm({ ...form, options: { routers: [e.target.value] } })}
            />
          </label>
          <div className="actions">
            <button className="primary" type="submit">
              Save subnet
            </button>
            {editingId && (
              <button className="secondary" type="button" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
