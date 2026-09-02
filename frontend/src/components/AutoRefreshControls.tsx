import { REFRESH_INTERVALS } from '../hooks/useAutoRefresh'

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
  return (
    <div className="auto-refresh-controls">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        Auto refresh
      </label>
      <select
        value={intervalMs}
        disabled={!enabled}
        aria-label="Refresh interval"
        onChange={(event) => onIntervalChange(Number(event.target.value))}
      >
        {REFRESH_INTERVALS.map((option) => (
          <option key={option.ms} value={option.ms}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" className="secondary" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  )
}
