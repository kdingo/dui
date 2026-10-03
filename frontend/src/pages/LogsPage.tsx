import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { Flash } from '../components/Flash'

export function LogsPage() {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const data = await api.logs(500)
      setLines(data.lines)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    }
  })

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div>
      <div className="actions page-header">
        <h2>View logs</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <Flash kind="error" message={error} />
      <div className="log-viewer" ref={logRef}>{lines.join('\n') || 'No log lines yet.'}</div>
    </div>
  )
}
