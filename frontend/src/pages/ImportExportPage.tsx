import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Flash } from '../components/Flash'
import { Tabs } from '../components/Tabs'

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
      <Flash kind="error" message={error} />
      <Flash message={message} />
      <div className="panel">
        <div className="actions page-header">
          <button className="secondary" onClick={handleExport}>
            Download zip
          </button>
          <button className="primary" onClick={handleImport}>
            Import and apply
          </button>
        </div>
        <Tabs
          id="import-method"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'zip', label: 'Zip file' },
            { value: 'paste', label: 'Paste' },
          ]}
        />
        {method === 'zip' ? (
          <label className="form-grid wide">
            Zip file
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
            <span className="muted">
              Contains the entire /data directory (config, leases, users, snapshots). Logs are not included.
            </span>
          </label>
        ) : (
          <div className="form-grid wide">
            <label>
              dhcpd.conf
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                className="mono"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
