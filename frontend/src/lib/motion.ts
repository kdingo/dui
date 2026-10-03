import type { Transition } from 'motion/react'

export const EASE_OUT = [0.22, 1, 0.36, 1] as const

/** Snappy spring for sliding indicators (nav pill, tabs). */
export const PILL_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }

/** Softer spring for surfaces that pop in (dialogs, cards). */
export const POP_SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32 }
