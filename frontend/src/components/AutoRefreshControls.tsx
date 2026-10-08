import { useTranslation } from 'react-i18next'
import { REFRESH_INTERVALS } from '../hooks/useAutoRefresh'
import { formatDuration } from '../i18n/format'

type AutoRefreshControlsProps = {
  enabled: boolean
  intervalMs: number
  onEnabledChange: (enabled: boolean) => void
  onIntervalChange: (intervalMs: number) => void
  onRefresh: () => void
}

export function AutoRefreshControls({
  enabled,
  intervalMs,
  onEnabledChange,
  onIntervalChange,
  onRefresh,
}: AutoRefreshControlsProps) {
  const { t } = useTranslation()
  return (
    <div className="auto-refresh-controls">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        {t('autoRefresh.toggle')}
      </label>
      <select
        value={intervalMs}
        disabled={!enabled}
        aria-label={t('autoRefresh.interval')}
        onChange={(event) => onIntervalChange(Number(event.target.value))}
      >
        {REFRESH_INTERVALS.map((ms) => (
          <option key={ms} value={ms}>
            {formatDuration(ms)}
          </option>
        ))}
      </select>
      <button type="button" className="secondary" onClick={onRefresh}>
        {t('autoRefresh.refresh')}
      </button>
    </div>
  )
}
