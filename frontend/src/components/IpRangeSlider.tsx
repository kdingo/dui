import { useState } from 'react'
import { intToIPv4 } from '../lib/ipv4'

type IpRangeSliderProps = {
  /** Lowest selectable address, as an unsigned 32-bit integer. */
  min: number
  /** Highest selectable address, as an unsigned 32-bit integer. */
  max: number
  start: number
  end: number
  onChange: (start: number, end: number) => void
  disabled?: boolean
}

function LockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Two-handle slider selecting a contiguous IPv4 range within [min, max]. */
export function IpRangeSlider({ min, max, start, end, onChange, disabled = false }: IpRangeSliderProps) {
  // Which handle was touched last; it stays on top so overlapping handles remain grabbable.
  const [active, setActive] = useState<'start' | 'end'>('end')

  const span = Math.max(max - min, 1)
  const lo = disabled ? min : Math.min(Math.max(start, min), max)
  const hi = disabled ? max : Math.min(Math.max(end, lo), max)
  const loPct = disabled ? 0 : ((lo - min) / span) * 100
  const hiPct = disabled ? 100 : ((hi - min) / span) * 100
  const count = hi - lo + 1
  // When the handles coincide, raise the one that still has room to move.
  const startOnTop = lo === hi ? lo - min > span / 2 : active === 'start'

  return (
    <div className={`ip-range${disabled ? ' locked' : ''}`}>
      <div className="ip-range-head">
        <span>Range</span>
        {disabled ? (
          <span className="ip-range-hint">
            <LockGlyph /> Enter a valid network and mask
          </span>
        ) : (
          <span className="ip-range-count">
            {count.toLocaleString()} {count === 1 ? 'IP' : 'IPs'}
          </span>
        )}
      </div>
      <div className="ip-range-track">
        <div
          className="ip-range-fill"
          style={{
            left: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${loPct / 100})`,
            right: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${(100 - hiPct) / 100})`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={lo}
          disabled={disabled}
          aria-label="Range start"
          aria-valuetext={intToIPv4(lo)}
          style={{ zIndex: startOnTop ? 3 : 2 }}
          onPointerDown={() => setActive('start')}
          onFocus={() => setActive('start')}
          onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={hi}
          disabled={disabled}
          aria-label="Range end"
          aria-valuetext={intToIPv4(hi)}
          style={{ zIndex: startOnTop ? 2 : 3 }}
          onPointerDown={() => setActive('end')}
          onFocus={() => setActive('end')}
          onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
        />
      </div>
      <div className="ip-range-ends mono">
        <span>{disabled ? '—' : intToIPv4(lo)}</span>
        <span>{disabled ? '—' : intToIPv4(hi)}</span>
      </div>
    </div>
  )
}
