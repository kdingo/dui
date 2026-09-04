import { useState } from 'react'
import { api } from '../api/client'
import type { SubnetUsage } from '../api/types'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

export function DashboardPage() {
  const [subnets, setSubnets] = useState<SubnetUsage[]>([])
  const [error, setError] = useState('')

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.dashboard()
      setSubnets(data.subnets)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    }
  })

  return (
    <div>
      <div className="actions page-header">
        <h2>Dashboard</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <p className="muted">Subnet utilization across configured DHCP pools.</p>
      {error && <div className="error">{error}</div>}
      <div className="card-grid">
        {subnets.map((subnet) => (
          <div className="card" key={subnet.id}>
            <h3>
              {subnet.name || subnet.network}
            </h3>
            {subnet.name && (
              <p className="muted">
                {subnet.network}
              </p>
            )}
            <p className="muted">
              Pool: {subnet.range_start || 'n/a'} – {subnet.range_end || 'n/a'}
            </p>
            <p>
              {subnet.used} used / {subnet.total} total ({subnet.free} free)
            </p>
            <div className="utilization">
              <span style={{ width: `${Math.min(subnet.utilization_pct, 100)}%` }} />
            </div>
            <p>{subnet.utilization_pct}% utilized</p>
          </div>
        ))}
        {!subnets.length && !error && <div className="card">No subnets configured yet.</div>}
      </div>
    </div>
  )
}
