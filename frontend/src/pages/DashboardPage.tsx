import { useState } from 'react'
import { motion } from 'motion/react'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { SubnetUsage } from '../api/types'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { Flash } from '../components/Flash'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { errorMessage } from '../i18n/apiError'
import { formatNumber } from '../i18n/format'
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
  const { t } = useTranslation()
  const [subnets, setSubnets] = useState<SubnetUsage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.dashboard()
      setSubnets(data.subnets)
      setError('')
    } catch (err) {
      setError(errorMessage(err, t('dashboard.loadFailed')))
    } finally {
      setLoaded(true)
    }
  })

  return (
    <div>
      <div className="actions page-header">
        <h2>{t('dashboard.title')}</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <p className="muted page-subtitle">{t('dashboard.subtitle')}</p>
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
                    {formatNumber(subnet.utilization_pct)}
                    <small>%</small>
                  </span>
                </div>
                {subnet.name && <span className="muted mono">{subnet.network}</span>}
                <span className="muted">
                  {t('dashboard.pool', {
                    start: subnet.range_start || t('dashboard.notAvailable'),
                    end: subnet.range_end || t('dashboard.notAvailable'),
                  })}
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
                    <Trans
                      i18nKey="dashboard.used"
                      values={{ used: subnet.used, total: subnet.total }}
                      components={{ strong: <strong />, muted: <span className="muted" /> }}
                    />
                  </span>
                  <span className="muted">{t('dashboard.free', { count: subnet.free })}</span>
                </div>
              </motion.div>
            )
          })}
          {!subnets.length && !error && (
            <motion.div className="card" variants={cardVariants}>
              {t('dashboard.empty')}
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  )
}
