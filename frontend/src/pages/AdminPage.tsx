import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { DhcpStatus, PasswordPolicy, ServerInfo, SyslogConfig } from '../api/types'
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

const SYSLOG_CATEGORIES = ['leases', 'server', 'users'] as const satisfies readonly (keyof SyslogConfig)[]

const DEFAULT_SYSLOG: SyslogConfig = {
  enabled: false,
  host: '',
  port: 514,
  protocol: 'udp',
  app_name: 'dui',
  leases: true,
  server: true,
  users: true,
}

export function AdminPage() {
  const { t } = useTranslation()
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<DhcpStatus | null>(null)
  const [serverName, setServerName] = useState('')
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY)
  const [syslog, setSyslog] = useState<SyslogConfig>(DEFAULT_SYSLOG)
  const [syslogTesting, setSyslogTesting] = useState(false)
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
    // Loaded once, not in refresh(), so other cards' saves don't discard unsaved syslog edits.
    api
      .syslogConfig()
      .then(setSyslog)
      .catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
  }, [])

  async function saveSyslog(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      setSyslog(await api.updateSyslogConfig(syslog))
      setMessage(t('admin.syslog.saved'))
    } catch (err) {
      setError(errorMessage(err, t('admin.syslog.saveFailed')))
    }
  }

  async function testSyslog() {
    setError('')
    setMessage('')
    setSyslogTesting(true)
    try {
      await api.testSyslog(syslog)
      setMessage(t('admin.syslog.testSent', { host: syslog.host, port: syslog.port }))
    } catch (err) {
      setError(errorMessage(err, t('admin.syslog.testFailed')))
    } finally {
      setSyslogTesting(false)
    }
  }

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
          <h3>{t('admin.syslog.title')}</h3>
          <form className="form-grid" onSubmit={saveSyslog}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={syslog.enabled}
                onChange={(e) => setSyslog({ ...syslog, enabled: e.target.checked })}
              />
              {t('admin.syslog.enabled')}
            </label>
            <label>
              {t('admin.syslog.host')}
              <input
                value={syslog.host}
                placeholder="192.168.1.10"
                onChange={(e) => setSyslog({ ...syslog, host: e.target.value })}
                required={syslog.enabled}
              />
            </label>
            <label>
              {t('admin.syslog.port')}
              <input
                type="number"
                min={1}
                max={65535}
                value={syslog.port}
                onChange={(e) => setSyslog({ ...syslog, port: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              {t('admin.syslog.protocol')}
              <select
                value={syslog.protocol}
                onChange={(e) => setSyslog({ ...syslog, protocol: e.target.value as SyslogConfig['protocol'] })}
              >
                <option value="udp">UDP</option>
                <option value="tcp">TCP</option>
              </select>
            </label>
            {SYSLOG_CATEGORIES.map((category) => (
              <label key={category} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={syslog[category]}
                  onChange={(e) => setSyslog({ ...syslog, [category]: e.target.checked })}
                />
                {t(`admin.syslog.categories.${category}`)}
              </label>
            ))}
            <div className="actions">
              <button className="secondary" type="button" disabled={!syslog.host || syslogTesting} onClick={testSyslog}>
                {t('admin.syslog.test')}
              </button>
              <button className="primary" type="submit">
                {t('admin.syslog.save')}
              </button>
            </div>
          </form>
          <p className="muted">{t('admin.syslog.note')}</p>
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
