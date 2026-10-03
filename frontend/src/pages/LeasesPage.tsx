import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Lease } from '../api/types'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { parseIPv4, splitCidr } from '../lib/ipv4'
import { Flash } from '../components/Flash'
import { Tabs } from '../components/Tabs'

function compareCidrAscending(a: string, b: string): number {
  const aParts = splitCidr(a)
  const bParts = splitCidr(b)
  if (aParts && bParts) {
    const aIp = parseIPv4(aParts.address)
    const bIp = parseIPv4(bParts.address)
    if (aIp !== null && bIp !== null && aIp !== bIp) {
      return aIp - bIp
    }
    if (aParts.prefix !== bParts.prefix) {
      return aParts.prefix - bParts.prefix
    }
  }
  return a.localeCompare(b)
}

export function LeasesPage() {
  const [leases, setLeases] = useState<Lease[]>([])
  const [subnet, setSubnet] = useState<string>('all')
  const [error, setError] = useState('')

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.leases()
      setLeases(data.leases)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leases')
    }
  })

  const subnets = useMemo(() => {
    const values = new Set<string>()
    leases.forEach((lease) => {
      if (lease.subnet_network) values.add(lease.subnet_network)
    })
    return Array.from(values).sort(compareCidrAscending)
  }, [leases])

  const filtered = subnet === 'all' ? leases : leases.filter((lease) => lease.subnet_network === subnet)

  return (
    <div>
      <div className="actions page-header">
        <h2>Leases</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <Tabs
        id="lease-subnet"
        value={subnet}
        onChange={setSubnet}
        options={[{ value: 'all', label: 'All' }, ...subnets.map((value) => ({ value, label: value }))]}
      />
      <Flash kind="error" message={error} />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>IP</th>
              <th>MAC</th>
              <th>Hostname</th>
              <th>Starts</th>
              <th>Ends</th>
              <th>State</th>
              <th>Subnet</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lease, index) => (
              <tr key={`${lease.ip}-${lease.mac}-${lease.starts}-${lease.binding_state}-${index}`}>
                <td>{lease.ip}</td>
                <td>{lease.mac || '—'}</td>
                <td>{lease.hostname || '—'}</td>
                <td>{lease.starts || '—'}</td>
                <td>{lease.ends || '—'}</td>
                <td>{lease.binding_state || '—'}</td>
                <td>{lease.subnet_network || '—'}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7}>No leases found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
