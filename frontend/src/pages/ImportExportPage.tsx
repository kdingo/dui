import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function ImportExportPage() {
  const { isAdmin } = useAuth()
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.exportConfig().then(setContent).catch((err) => setError(err.message))
  }, [])

  async function handleExport() {
    const text = await api.exportConfig()
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'dhcpd.conf'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport() {
    if (!isAdmin) return
    try {
      await api.importConfig(content)
      setMessage('Configuration imported and applied.')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div>
      <h2>Import / export</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <div className="panel">
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <button className="secondary" onClick={handleExport}>
            Download dhcpd.conf
          </button>
          {isAdmin && (
            <button className="primary" onClick={handleImport}>
              Import and apply
            </button>
          )}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={24}
          style={{ width: '100%', fontFamily: 'monospace' }}
          readOnly={!isAdmin}
        />
      </div>
    </div>
  )
}
