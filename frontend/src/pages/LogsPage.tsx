import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function LogsPage() {
  const [lines, setLines] = useState<string[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const data = await api.logs(500)
        if (active) setLines(data.lines)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load logs')
      }
    }

    load()
    if (!autoRefresh) return () => {
      active = false
    }

    const timer = window.setInterval(load, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [autoRefresh])

  return (
    <div>
      <div className="actions" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, flex: 1 }}>View logs</h2>
        <label>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto
          refresh
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="log-viewer">{lines.join('\n') || 'No log lines yet.'}</div>
    </div>
  )
}
