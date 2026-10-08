import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { Flash } from '../components/Flash'
import { errorMessage } from '../i18n/apiError'

export function LogsPage() {
  const { t } = useTranslation()
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.logs(500)
      setLines(data.lines)
      setError('')
    } catch (err) {
      setError(errorMessage(err, t('logs.loadFailed')))
    }
  })

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div>
      <div className="actions page-header">
        <h2>{t('logs.title')}</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <Flash kind="error" message={error} />
      <div className="log-viewer" ref={logRef}>{lines.join('\n') || t('logs.empty')}</div>
    </div>
  )
}
