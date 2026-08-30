import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SubnetUsage } from '../api/types'

export function DashboardPage() {
  const [subnets, setSubnets] = useState<SubnetUsage[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .dashboard()
      .then((data) => setSubnets(data.subnets))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
  }, [])

  return (
    <div>
      <h2>Dashboard</h2>
      <p className="muted">Subnet utilization across configured DHCP pools.</p>
      {error && <div className="error">{error}</div>}
      <div className="card-grid">
        {subnets.map((subnet) => (
          <div className="card" key={subnet.id}>
            <h3>
              {subnet.network}/{subnet.netmask}
            </h3>
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
