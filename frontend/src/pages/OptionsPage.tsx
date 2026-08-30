import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpConfig } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function OptionsPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [dns, setDns] = useState('')
  const [leaseTime, setLeaseTime] = useState('86400')
  const [maxLeaseTime, setMaxLeaseTime] = useState('604800')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api
      .getConfig()
      .then((data) => {
        setConfig(data)
        const dnsServers = data.global_options['domain-name-servers']
        setDns(Array.isArray(dnsServers) ? dnsServers.join(', ') : String(dnsServers || ''))
        setLeaseTime(String(data.global_options['default-lease-time'] || 86400))
        setMaxLeaseTime(String(data.global_options['max-lease-time'] || 604800))
      })
      .catch((err) => setError(err.message))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin || !config) return
    try {
      const global_options = {
        ...config.global_options,
        'domain-name-servers': dns.split(',').map((value) => value.trim()).filter(Boolean),
        'default-lease-time': Number(leaseTime),
        'max-lease-time': Number(maxLeaseTime),
      }
      const updated = await api.updateOptions(global_options)
      setConfig(updated)
      setMessage('Options saved and applied.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h2>Options</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <form className="panel form-grid" onSubmit={handleSubmit}>
        <label>
          DNS servers (comma separated)
          <input value={dns} onChange={(e) => setDns(e.target.value)} disabled={!isAdmin} />
        </label>
        <label>
          Default lease time (seconds)
          <input value={leaseTime} onChange={(e) => setLeaseTime(e.target.value)} disabled={!isAdmin} />
        </label>
        <label>
          Max lease time (seconds)
          <input value={maxLeaseTime} onChange={(e) => setMaxLeaseTime(e.target.value)} disabled={!isAdmin} />
        </label>
        {isAdmin && (
          <button className="primary" type="submit">
            Save options
          </button>
        )}
      </form>
    </div>
  )
}
