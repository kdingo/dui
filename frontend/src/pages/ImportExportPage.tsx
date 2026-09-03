import { useEffect, useState } from 'react'
import { api } from '../api/client'

type ImportMethod = 'zip' | 'paste'

export function ImportExportPage() {
  const [method, setMethod] = useState<ImportMethod>('zip')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [content, setContent] = useState('')
  const [pasteLoaded, setPasteLoaded] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (method !== 'paste' || pasteLoaded) return
    api
      .exportDhcpdConf()
      .then((conf) => {
        setContent(conf)
        setPasteLoaded(true)
      })
      .catch((err) => setError(err.message))
  }, [method, pasteLoaded])

  async function handleExport() {
    try {
      const blob = await api.exportConfig()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'dui-data.zip'
      anchor.click()
      URL.revokeObjectURL(url)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  async function handleImport() {
    try {
      if (method === 'zip') {
        if (!zipFile) {
          setError('Choose a zip file to import.')
          return
        }
        await api.importConfigZip(zipFile)
      } else {
        await api.importConfig(content)
      }
      setMessage('Configuration imported and applied.')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div>
      <h2>Import/Export</h2>
      {error && <div className="error">{error}</div>}
      {message && <p>{message}</p>}
      <div className="panel">
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <button className="secondary" onClick={handleExport}>
            Download zip
          </button>
          <button className="primary" onClick={handleImport}>
            Import and apply
          </button>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={method === 'zip' ? 'active' : ''}
            onClick={() => setMethod('zip')}
          >
            Zip file
          </button>
          <button
            type="button"
            className={method === 'paste' ? 'active' : ''}
            onClick={() => setMethod('paste')}
          >
            Paste
          </button>
        </div>
        {method === 'zip' ? (
          <label className="form-grid" style={{ maxWidth: 'none' }}>
            Zip file
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
            <span className="muted">
              Contains the entire /data directory (config, leases, users). Snapshots and logs are not included.
            </span>
          </label>
        ) : (
          <div className="form-grid" style={{ maxWidth: 'none' }}>
            <label>
              dhcpd.conf
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
