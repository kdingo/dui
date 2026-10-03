import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DhcpConfig } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Flash } from '../components/Flash'

function optionToInput(value: unknown): string {
  if (value == null || value === '') return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function OptionsPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [dns, setDns] = useState('')
  const [ntp, setNtp] = useState('')
  const [domainName, setDomainName] = useState('')
  const [domainSearch, setDomainSearch] = useState('')
  const [leaseTime, setLeaseTime] = useState('86400')
  const [maxLeaseTime, setMaxLeaseTime] = useState('604800')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api
      .getConfig()
      .then((data) => {
        setConfig(data)
        setDns(optionToInput(data.global_options['domain-name-servers']))
        setNtp(optionToInput(data.global_options['ntp-servers']))
        setDomainName(optionToInput(data.global_options['domain-name']))
        setDomainSearch(optionToInput(data.global_options['domain-search']))
        setLeaseTime(String(data.global_options['default-lease-time'] || 86400))
        setMaxLeaseTime(String(data.global_options['max-lease-time'] || 604800))
      })
      .catch((err) => setError(err.message))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin || !config) return
    try {
      const global_options: Record<string, unknown> = {
        ...config.global_options,
        'domain-name-servers': splitList(dns),
        'default-lease-time': Number(leaseTime),
        'max-lease-time': Number(maxLeaseTime),
      }

      const ntpServers = splitList(ntp)
      const searchList = splitList(domainSearch)
      const trimmedDomain = domainName.trim()

      if (ntpServers.length) global_options['ntp-servers'] = ntpServers
      else delete global_options['ntp-servers']

      if (trimmedDomain) global_options['domain-name'] = trimmedDomain
      else delete global_options['domain-name']

      if (searchList.length) global_options['domain-search'] = searchList
      else delete global_options['domain-search']

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
      <Flash kind="error" message={error} />
      <Flash message={message} />
      <form className="panel form-grid" onSubmit={handleSubmit}>
        <label>
          DNS servers (comma separated)
          <input value={dns} onChange={(e) => setDns(e.target.value)} disabled={!isAdmin} />
        </label>
        <label>
          NTP servers (comma separated)
          <input value={ntp} onChange={(e) => setNtp(e.target.value)} disabled={!isAdmin} />
        </label>
        <label>
          Domain name
          <input value={domainName} onChange={(e) => setDomainName(e.target.value)} disabled={!isAdmin} />
        </label>
        <label>
          Domain search (comma separated)
          <input value={domainSearch} onChange={(e) => setDomainSearch(e.target.value)} disabled={!isAdmin} />
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
