import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { DhcpStatus, PasswordPolicy, ServerInfo } from '../api/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { errorMessage } from '../i18n/apiError'
import { DEFAULT_POLICY, POLICY_MAX_LENGTH, POLICY_MIN_LENGTH_FLOOR } from '../lib/passwordPolicy'

const POLICY_RULES = [
  'require_lowercase',
  'require_uppercase',
  'require_digit',
  'require_symbol',
  'disallow_username',
] as const satisfies readonly (keyof Omit<PasswordPolicy, 'min_length'>)[]

export function AdminPage() {
  const { t } = useTranslation()
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<DhcpStatus | null>(null)
  const [serverName, setServerName] = useState('')
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const confirm = useConfirm()

  async function refresh() {
    const [serverInfo, dhcpStatus, passwordPolicy] = await Promise.all([
      api.serverInfo(),
      api.dhcpStatus(),
      api.passwordPolicy(),
    ])
    setServer(serverInfo)
    setPolicy(passwordPolicy)
    setServerName(serverInfo.name)
    setStatus(dhcpStatus)
  }

  useEffect(() => {
    refresh().catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
  }, [])

  async function saveServerName(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await api.updateServerName(serverName)
      setMessage(t('admin.nameUpdated'))
      await refresh()
    } catch (err) {
      setError(errorMessage(err, t('common.saveFailed')))
    }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      setPolicy(await api.updatePasswordPolicy(policy))
      setMessage(t('admin.policySaved'))
    } catch (err) {
      setError(errorMessage(err, t('admin.policyFailed')))
    }
  }

  async function dhcpAction(action: 'start' | 'stop' | 'restart') {
    setError('')
    setMessage('')
    try {
      await api.dhcpControl(action)
      setMessage(t(`admin.dhcpRequested.${action}`))
      await refresh()
    } catch (err) {
      setError(errorMessage(err, t('common.saveFailed')))
    }
  }

  async function containerAction(action: 'stop' | 'restart') {
    const confirmed = await confirm({
      title: action === 'stop' ? t('admin.stopContainerTitle') : t('admin.restartContainerTitle'),
      message: action === 'stop' ? t('admin.stopContainerMessage') : t('admin.restartContainerMessage'),
      confirmLabel: action === 'stop' ? t('admin.stopContainer') : t('admin.restartContainer'),
      danger: action === 'stop',
    })
    if (!confirmed) return
    if (action === 'stop') await api.containerStop()
    else await api.containerRestart()
  }

  return (
    <div>
      <h2>{t('admin.title')}</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />

      <div className="card-grid">
        <div className="card">
          <h3>{t('admin.server')}</h3>
          <form className="form-grid" onSubmit={saveServerName}>
            <label>
              {t('admin.displayName')}
              <input value={serverName} onChange={(e) => setServerName(e.target.value)} />
            </label>
            <button className="primary" type="submit">
              {t('admin.saveName')}
            </button>
          </form>
          {server && (
            <p className="muted">
              {t('admin.serverInfo', { interface: server.interface, port: server.http_port })}
            </p>
          )}
        </div>

        <div className="card">
          <h3>{t('admin.policyTitle')}</h3>
          <form className="form-grid" onSubmit={savePolicy}>
            <label>
              {t('admin.minLength', { min: POLICY_MIN_LENGTH_FLOOR, max: POLICY_MAX_LENGTH })}
              <input
                type="number"
                min={POLICY_MIN_LENGTH_FLOOR}
                max={POLICY_MAX_LENGTH}
                value={policy.min_length}
                onChange={(e) => setPolicy({ ...policy, min_length: Number(e.target.value) })}
                required
              />
            </label>
            {POLICY_RULES.map((rule) => (
              <label key={rule} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={policy[rule]}
                  onChange={(e) => setPolicy({ ...policy, [rule]: e.target.checked })}
                />
                {t(`admin.rules.${rule}`)}
              </label>
            ))}
            <button className="primary" type="submit">
              {t('admin.savePolicy')}
            </button>
          </form>
          <p className="muted">{t('admin.policyNote')}</p>
        </div>

        <div className="card">
          <h3>{t('admin.dhcpTitle')}</h3>
          <p>
            <span className={`status-dot ${status?.running ? 'on' : ''}`} aria-hidden="true" />
            {status?.running ? t('admin.running') : t('admin.stopped')}
          </p>
          <p className="muted">{status?.detail}</p>
          <div className="actions">
            <button className="secondary" disabled={Boolean(status?.running)} onClick={() => dhcpAction('start')}>
              {t('admin.start')}
            </button>
            <button className="secondary" disabled={!status?.running} onClick={() => dhcpAction('stop')}>
              {t('admin.stop')}
            </button>
            <button className="secondary" disabled={!status?.running} onClick={() => dhcpAction('restart')}>
              {t('admin.restart')}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>{t('admin.containerTitle')}</h3>
          <div className="actions">
            <button className="danger" onClick={() => containerAction('stop')}>
              {t('admin.stopContainer')}
            </button>
            <button className="secondary" onClick={() => containerAction('restart')}>
              {t('admin.restartContainer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
