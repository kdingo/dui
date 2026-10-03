import { AnimatePresence, motion } from 'motion/react'
import { EASE_OUT } from '../lib/motion'

interface FlashProps {
  message: string
  kind?: 'success' | 'error'
}

/** Inline status message that slides in when set and out when cleared. */
export function Flash({ message, kind = 'success' }: FlashProps) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={kind}
          className={kind === 'error' ? 'error' : 'notice'}
          role={kind === 'error' ? 'alert' : 'status'}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
