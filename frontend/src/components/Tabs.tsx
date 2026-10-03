import { motion } from 'motion/react'
import { PILL_SPRING } from '../lib/motion'

interface TabsProps<T extends string> {
  /** Unique per tab group so the sliding pill never jumps between groups. */
  id: string
  value: T
  options: { value: T; label: React.ReactNode }[]
  onChange: (value: T) => void
}

export function Tabs<T extends string>({ id, value, options, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {active && <motion.span layoutId={`${id}-pill`} className="tab-pill" transition={PILL_SPRING} />}
            <span className="tab-label">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
