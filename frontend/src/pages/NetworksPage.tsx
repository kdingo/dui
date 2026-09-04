import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { DhcpConfig, DhcpSubnet } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { CIDR_PREFIXES, ipv4NetworkPreview, splitCidr } from '../lib/ipv4'

const emptySubnet = {
  name: '',
  address: '',
  prefix: 24,
  range: { start: '', end: '' },
  options: { routers: [''] },
}

/** dhcpd.conf parser returns a string for a single router, or a list when comma-separated. */
function routersList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return []
}

export function NetworksPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [form, setForm] = useState(emptySubnet)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const preview = useMemo(
    () => ipv4NetworkPreview(form.address, form.prefix),
    [form.address, form.prefix],
  )

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
    const subnet = ipv4NetworkPreview(form.address, form.prefix)
    if (!subnet) {
      setError('Enter a valid IPv4 network address.')
      return
    }
    const payload = {
      name: form.name.trim() || null,
      network: subnet.cidr,
      range: form.range.start && form.range.end ? form.range : null,
      options: {
        routers: routersList(form.options.routers).slice(0, 1),
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
    const routers = routersList(subnet.options?.routers)
    const parsed = splitCidr(subnet.network)
    setForm({
      name: subnet.name || '',
      address: parsed?.address || '',
      prefix: parsed?.prefix ?? 24,
      range: subnet.range || { start: '', end: '' },
      options: { routers: routers.length ? routers : [''] },
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
              <th>Name</th>
              <th>Network</th>
              <th>Range</th>
              <th>Router</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {config?.subnets.map((subnet) => (
              <tr key={subnet.id}>
                <td>{subnet.name || '—'}</td>
                <td>{subnet.network}</td>
                <td>
                  {subnet.range ? `${subnet.range.start} - ${subnet.range.end}` : '—'}
                </td>
                <td>{routersList(subnet.options?.routers).join(', ') || '—'}</td>
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
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Network
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="192.168.1.0"
              required
            />
          </label>
          <label>
            CIDR
            <select
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: Number(e.target.value) })}
            >
              {CIDR_PREFIXES.map((prefix) => (
                <option key={prefix} value={prefix}>
                  /{prefix}
                </option>
              ))}
            </select>
          </label>
          {preview && (
            <p className="muted">
              Netmask {preview.netmask}
              <br />
              Range {preview.network} – {preview.broadcast}
              <br />
              {preview.size.toLocaleString()} IPs
            </p>
          )}
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
              value={routersList(form.options.routers)[0] || ''}
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
