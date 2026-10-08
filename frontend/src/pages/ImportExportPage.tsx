import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { Flash } from '../components/Flash'
import { Tabs } from '../components/Tabs'
import { errorMessage } from '../i18n/apiError'

type ImportMethod = 'zip' | 'paste'

export function ImportExportPage() {
  const { t } = useTranslation()
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
      .catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
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
      setError(errorMessage(err, t('importExport.exportFailed')))
    }
  }

  async function handleImport() {
    try {
      if (method === 'zip') {
        if (!zipFile) {
          setError(t('importExport.chooseZip'))
          return
        }
        await api.importConfigZip(zipFile)
      } else {
        await api.importConfig(content)
      }
      setMessage(t('importExport.imported'))
      setError('')
    } catch (err) {
      setError(errorMessage(err, t('importExport.importFailed')))
    }
  }

  return (
    <div>
      <h2>{t('importExport.title')}</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />
      <div className="panel">
        <div className="actions page-header">
          <button className="secondary" onClick={handleExport}>
            {t('importExport.download')}
          </button>
          <button className="primary" onClick={handleImport}>
            {t('importExport.import')}
          </button>
        </div>
        <Tabs
          id="import-method"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'zip', label: t('importExport.zipTab') },
            { value: 'paste', label: t('importExport.pasteTab') },
          ]}
        />
        {method === 'zip' ? (
          <label className="form-grid wide">
            {t('importExport.zipFile')}
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
            <span className="muted">
              {t('importExport.zipHint')}
            </span>
          </label>
        ) : (
          <div className="form-grid wide">
            <label>
              {t('importExport.dhcpdConf')}
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
