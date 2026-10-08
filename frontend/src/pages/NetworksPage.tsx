import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { DhcpConfig, DhcpSubnet } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../i18n/apiError'
import { CIDR_PREFIXES, intToIPv4, ipv4NetworkPreview, parseIPv4, prefixToNetmask, splitCidr } from '../lib/ipv4'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { IpRangeSlider } from '../components/IpRangeSlider'

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
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [form, setForm] = useState(emptySubnet)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const confirm = useConfirm()
  const autoRouter = useRef('')

  const preview = useMemo(
    () => ipv4NetworkPreview(form.address, form.prefix),
    [form.address, form.prefix],
  )

  useEffect(() => {
    api.getConfig().then(setConfig).catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
  }, [])

  // Once the network is valid, make sure the range sits inside it; otherwise default to all hosts.
  useEffect(() => {
    if (!preview) return
    const { firstHost, lastHost } = preview
    setForm((current) => {
      const start = parseIPv4(current.range.start)
      const end = parseIPv4(current.range.end)
      const fits =
        start !== null && end !== null && start >= firstHost && end <= lastHost && start <= end
      if (fits) return current
      return { ...current, range: { start: intToIPv4(firstHost), end: intToIPv4(lastHost) } }
    })
  }, [preview?.cidr])

  // When adding, default the router to the first host, unless the user has typed their own.
  useEffect(() => {
    if (!preview || editingId) return
    const suggested = intToIPv4(preview.firstHost)
    setForm((current) => {
      const router = routersList(current.options.routers)[0] || ''
      if (router && router !== autoRouter.current) return current
      autoRouter.current = suggested
      return { ...current, options: { routers: [suggested] } }
    })
  }, [preview?.cidr])

  const rangeStart = parseIPv4(form.range.start) ?? preview?.firstHost ?? 0
  const rangeEnd = parseIPv4(form.range.end) ?? preview?.lastHost ?? 0

  function resetForm() {
    setForm(emptySubnet)
    setEditingId(null)
    autoRouter.current = ''
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin) return
    setError('')
    setMessage('')
    const subnet = ipv4NetworkPreview(form.address, form.prefix)
    if (!subnet) {
      setError(t('networks.invalidNetwork'))
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
      setMessage(editingId ? t('networks.updated') : t('networks.added'))
      resetForm()
    } catch (err) {
      setError(errorMessage(err, t('common.saveFailed')))
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
    if (!isAdmin) return
    const confirmed = await confirm({
      title: t('networks.deleteTitle'),
      message: t('networks.deleteMessage'),
      confirmLabel: t('networks.deleteConfirm'),
      danger: true,
    })
    if (!confirmed) return
    try {
      setConfig(await api.deleteSubnet(id))
    } catch (err) {
      setError(errorMessage(err, t('common.deleteFailed')))
    }
  }

  return (
    <div>
      <h2>{t('networks.title')}</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('networks.network')}</th>
              <th>{t('networks.range')}</th>
              <th>{t('networks.router')}</th>
              {isAdmin && <th>{t('common.actions')}</th>}
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
                      {t('common.edit')}
                    </button>
                    <button className="danger" onClick={() => removeSubnet(subnet.id)}>
                      {t('common.delete')}
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
          <h3>{editingId ? t('networks.editTitle') : t('networks.addTitle')}</h3>
          <label>
            {t('common.name')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t('networks.network')}
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="192.168.1.0"
              required
            />
          </label>
          <label>
            {t('networks.cidr')}
            <select
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: Number(e.target.value) })}
            >
              {CIDR_PREFIXES.map((prefix) => (
                <option key={prefix} value={prefix}>
                  /{prefix} ({prefixToNetmask(prefix)})
                </option>
              ))}
            </select>
          </label>
          {preview && (
            <p className="muted">
              {t('networks.netmask', { netmask: preview.netmask })}
              <br />
              {t('networks.previewRange', { network: preview.network, broadcast: preview.broadcast })}
              <br />
              {t('networks.ips', { count: preview.size })}
            </p>
          )}
          <IpRangeSlider
            min={preview?.firstHost ?? 0}
            max={preview?.lastHost ?? 1}
            start={rangeStart}
            end={rangeEnd}
            disabled={!preview}
            onChange={(start, end) =>
              setForm({ ...form, range: { start: intToIPv4(start), end: intToIPv4(end) } })
            }
          />
          <div className="ip-range-fields">
            <label>
              {t('networks.rangeStart')}
              <input
                value={form.range.start}
                disabled={!preview}
                onChange={(e) => setForm({ ...form, range: { ...form.range, start: e.target.value } })}
              />
            </label>
            <label>
              {t('networks.rangeEnd')}
              <input
                value={form.range.end}
                disabled={!preview}
                onChange={(e) => setForm({ ...form, range: { ...form.range, end: e.target.value } })}
              />
            </label>
          </div>
          <label>
            {t('networks.router')}
            <input
              value={routersList(form.options.routers)[0] || ''}
              onChange={(e) => setForm({ ...form, options: { routers: [e.target.value] } })}
            />
          </label>
          <div className="actions">
            <button className="primary" type="submit">
              {t('networks.save')}
            </button>
            {editingId && (
              <button className="secondary" type="button" onClick={resetForm}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
