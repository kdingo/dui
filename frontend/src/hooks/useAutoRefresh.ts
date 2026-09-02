import { useCallback, useEffect, useRef, useState } from 'react'

export const REFRESH_INTERVALS = [
  { label: '5 seconds', ms: 5000 },
  { label: '30 seconds', ms: 30000 },
  { label: '1 minute', ms: 60000 },
  { label: '5 minutes', ms: 300000 },
] as const

export const DEFAULT_REFRESH_INTERVAL_MS = 60000
const STORAGE_KEY = 'dui.autoRefresh'

type AutoRefreshPrefs = {
  enabled: boolean
  intervalMs: number
}

function isAllowedInterval(ms: number) {
  return REFRESH_INTERVALS.some((option) => option.ms === ms)
}

function readPrefs(): AutoRefreshPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { enabled: true, intervalMs: DEFAULT_REFRESH_INTERVAL_MS }
    const parsed = JSON.parse(raw) as Partial<AutoRefreshPrefs>
    return {
      enabled: parsed.enabled !== false,
      intervalMs: typeof parsed.intervalMs === 'number' && isAllowedInterval(parsed.intervalMs)
        ? parsed.intervalMs
        : DEFAULT_REFRESH_INTERVAL_MS,
    }
  } catch {
    return { enabled: true, intervalMs: DEFAULT_REFRESH_INTERVAL_MS }
  }
}

function writePrefs(prefs: AutoRefreshPrefs) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function useAutoRefresh(load: () => void | Promise<void>) {
  const initial = useRef(readPrefs()).current
  const [enabled, setEnabledState] = useState(initial.enabled)
  const [intervalMs, setIntervalMsState] = useState(initial.intervalMs)
  const loadRef = useRef(load)
  const timerRef = useRef<number | undefined>(undefined)
  const enabledRef = useRef(enabled)
  const intervalRef = useRef(intervalMs)

  loadRef.current = load
  enabledRef.current = enabled
  intervalRef.current = intervalMs

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    if (!enabledRef.current) return
    timerRef.current = window.setInterval(() => {
      void loadRef.current()
    }, intervalRef.current)
  }, [clearTimer])

  useEffect(() => {
    writePrefs({ enabled, intervalMs })
  }, [enabled, intervalMs])

  useEffect(() => {
    let active = true

    async function run() {
      if (!active) return
      await loadRef.current()
    }

    void run()
    startTimer()

    return () => {
      active = false
      clearTimer()
    }
  }, [clearTimer, enabled, intervalMs, startTimer])

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
  }, [])

  const setIntervalMs = useCallback((value: number) => {
    if (!isAllowedInterval(value)) return
    setIntervalMsState(value)
  }, [])

  const refreshNow = useCallback(() => {
    void loadRef.current()
    startTimer()
  }, [startTimer])

  return { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow }
}
