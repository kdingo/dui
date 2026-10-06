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

type DaysHours = { days: string; hours: string }

function secondsToDaysHours(seconds: number): DaysHours {
  const days = Math.floor(seconds / 86400)
  const hours = Math.round(((seconds % 86400) / 3600) * 100) / 100
  return { days: String(days), hours: String(hours) }
}

function daysHoursToSeconds({ days, hours }: DaysHours): number {
  return Math.round((Number(days || 0) * 24 + Number(hours || 0)) * 3600)
}

function isValidDaysHours({ days, hours }: DaysHours): boolean {
  const d = Number(days || 0)
  const h = Number(hours || 0)
  return Number.isFinite(d) && Number.isFinite(h) && d >= 0 && h >= 0
}

function LeaseTimeField({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string
  value: DaysHours
  onChange: (value: DaysHours) => void
  disabled: boolean
}) {
  return (
    <fieldset className="duration-field">
      <legend>{legend}</legend>
      <label>
        Days
        <input
          type="number"
          min={0}
          step={1}
          value={value.days}
          onChange={(e) => onChange({ ...value, days: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        Hours
        <input
          type="number"
          min={0}
          max={23}
          step="any"
          value={value.hours}
          onChange={(e) => onChange({ ...value, hours: e.target.value })}
          disabled={disabled}
        />
      </label>
    </fieldset>
  )
}

export function OptionsPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<DhcpConfig | null>(null)
  const [dns, setDns] = useState('')
  const [ntp, setNtp] = useState('')
  const [domainName, setDomainName] = useState('')
  const [domainSearch, setDomainSearch] = useState('')
  const [leaseTime, setLeaseTime] = useState<DaysHours>({ days: '1', hours: '0' })
  const [maxLeaseTime, setMaxLeaseTime] = useState<DaysHours>({ days: '7', hours: '0' })
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
        setLeaseTime(secondsToDaysHours(Number(data.global_options['default-lease-time']) || 86400))
        setMaxLeaseTime(secondsToDaysHours(Number(data.global_options['max-lease-time']) || 604800))
      })
      .catch((err) => setError(err.message))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin || !config) return
    setError('')
    setMessage('')
    const leaseSeconds = daysHoursToSeconds(leaseTime)
    const maxLeaseSeconds = daysHoursToSeconds(maxLeaseTime)
    if (
      !isValidDaysHours(leaseTime) ||
      !isValidDaysHours(maxLeaseTime) ||
      leaseSeconds <= 0 ||
      maxLeaseSeconds <= 0
    ) {
      setError('Lease times must be greater than zero')
      return
    }
    try {
      const global_options: Record<string, unknown> = {
        ...config.global_options,
        'domain-name-servers': splitList(dns),
        'default-lease-time': leaseSeconds,
        'max-lease-time': maxLeaseSeconds,
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
        <LeaseTimeField legend="Default lease time" value={leaseTime} onChange={setLeaseTime} disabled={!isAdmin} />
        <LeaseTimeField legend="Max lease time" value={maxLeaseTime} onChange={setMaxLeaseTime} disabled={!isAdmin} />
        {isAdmin && (
          <button className="primary" type="submit">
            Save options
          </button>
        )}
      </form>
    </div>
  )
}
