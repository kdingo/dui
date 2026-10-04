import { useId } from 'react'
import { motion } from 'motion/react'

const BOWL = 'M18 10.3H46C46.6 14.5 49.2 22 49.2 31C49.2 40.5 46.6 47.4 38.5 47.4H25.5C17.4 47.4 14.8 40.5 14.8 31C14.8 22 17.4 14.5 18 10.3Z'
const LIQUID = 'M14 22.5H50V31C50 38.5 45.5 43.4 38 43.4H26C18.5 43.4 14 38.5 14 31Z'
const SURFACE_Y = 23.4
/** How far the liquid sits below its resting level when "empty". */
const EMPTY_OFFSET = 24

interface LogoProps {
  size?: number
  /** Animate the liquid level: once on mount, or continuously (loading state). */
  fill?: 'none' | 'once' | 'loop'
  className?: string
}

export function Logo({ size = 32, fill = 'none', className = '' }: LogoProps) {
  const id = useId()
  const bowlClip = `${id}-bowl`
  const liquidClip = `${id}-liquid`
  const outline = { stroke: '#26292B' }
  // Cream "sticker" rim, shown only where the theme sets it (dark backgrounds).
  const halo = { stroke: 'var(--logo-halo, transparent)' }

  const liquidMotion =
    fill === 'once'
      ? {
          initial: { y: EMPTY_OFFSET },
          animate: { y: 0 },
          transition: { duration: 1.1, ease: [0.22, 1, 0.36, 1] as const, delay: 0.15 },
        }
      : fill === 'loop'
        ? {
            initial: { y: EMPTY_OFFSET },
            animate: { y: [EMPTY_OFFSET, 0, 0, EMPTY_OFFSET] },
            transition: { duration: 2.4, times: [0, 0.45, 0.8, 1], ease: 'easeInOut' as const, repeat: Infinity },
          }
        : {}

  return (
    <svg
      className={`logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={bowlClip}>
          <path d={BOWL} />
        </clipPath>
        <clipPath id={liquidClip}>
          <path d={LIQUID} />
        </clipPath>
      </defs>

      <rect x="21.5" y="46.5" width="21" height="8.8" rx="3.4" strokeWidth="5.4" style={halo} />
      <path d={BOWL} strokeWidth="5.6" strokeLinejoin="round" style={halo} />

      {/* Foot */}
      <rect x="21.5" y="46.5" width="21" height="8.8" rx="3.4" fill="#F4EEE2" strokeWidth="2.4" style={outline} />
      <rect x="32" y="47.7" width="9.3" height="6.4" rx="1.6" fill="#E2D3B8" />

      <g clipPath={`url(#${bowlClip})`}>
        {/* Empty glass: lit left half, shaded right half */}
        <rect x="10" y="8" width="22" height="44" fill="#F4EEE2" />
        <rect x="32" y="8" width="22" height="44" fill="#E2D3B8" />

        <g clipPath={`url(#${liquidClip})`}>
          <motion.g {...liquidMotion}>
            <rect x="10" y="22" width="22" height="40" fill="#EDB257" />
            <rect x="32" y="22" width="22" height="40" fill="#C8843A" />
            <line x1="10" y1={SURFACE_Y} x2="54" y2={SURFACE_Y} strokeWidth="2.3" style={outline} />
          </motion.g>
        </g>

        {/* Glass highlight */}
        <path d="M22.8 14C21.8 20.5 21.8 30 23.2 37.4" stroke="#FFFDF8" strokeWidth="2.2" strokeLinecap="round" opacity="0.92" />
      </g>

      {/* Bowl outline drawn last so it stays crisp over the fills */}
      <path d={BOWL} strokeWidth="2.6" strokeLinejoin="round" style={outline} />
    </svg>
  )
}
