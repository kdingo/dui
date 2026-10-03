import { useState } from 'react'
import { motion } from 'motion/react'
import { api } from '../api/client'
import type { SubnetUsage } from '../api/types'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { Flash } from '../components/Flash'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { EASE_OUT, POP_SPRING } from '../lib/motion'

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: EASE_OUT } },
}

function utilizationLevel(pct: number) {
  if (pct >= 90) return 'crit'
  if (pct >= 70) return 'warn'
  return ''
}

export function DashboardPage() {
  const [subnets, setSubnets] = useState<SubnetUsage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.dashboard()
      setSubnets(data.subnets)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoaded(true)
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
      <p className="muted page-subtitle">Subnet utilization across configured DHCP pools.</p>
      <Flash kind="error" message={error} />
      {loaded && (
        <motion.div className="card-grid" variants={gridVariants} initial="hidden" animate="show">
          {subnets.map((subnet) => {
            const pct = Math.min(subnet.utilization_pct, 100)
            return (
              <motion.div
                className="card subnet-card"
                key={subnet.id}
                variants={cardVariants}
                whileHover={{ y: -3, transition: POP_SPRING }}
              >
                <div className="subnet-card-head">
                  <h3>{subnet.name || subnet.network}</h3>
                  <span className="subnet-pct">
                    {subnet.utilization_pct}
                    <small>%</small>
                  </span>
                </div>
                {subnet.name && <span className="muted mono">{subnet.network}</span>}
                <span className="muted">
                  Pool {subnet.range_start || 'n/a'} – {subnet.range_end || 'n/a'}
                </span>
                <div className={`utilization ${utilizationLevel(pct)}`}>
                  <motion.span
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 }}
                  />
                </div>
                <div className="subnet-stats">
                  <span>
                    <strong>{subnet.used}</strong> <span className="muted">used of {subnet.total}</span>
                  </span>
                  <span className="muted">{subnet.free} free</span>
                </div>
              </motion.div>
            )
          })}
          {!subnets.length && !error && (
            <motion.div className="card" variants={cardVariants}>
              No subnets configured yet.
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  )
}
