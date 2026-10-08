import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { POP_SPRING } from '../lib/motion'

export interface ConfirmOptions {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

const ConfirmContext = createContext<ConfirmFn>(async () => false)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const next = { ...options, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setPending(null)
    current.resolve(confirmed)
    returnFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!pending) return
    confirmButtonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      // Keep focus inside the dialog.
      const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'))
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pending, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {pending && (
          <motion.div
            key="confirm"
            className="dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close(false)
            }}
          >
            <motion.div
              ref={dialogRef}
              className="dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby={pending.message ? 'confirm-message' : undefined}
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.12 } }}
              transition={POP_SPRING}
            >
              <h3 id="confirm-title">{pending.title}</h3>
              {pending.message && (
                <p id="confirm-message" className="muted">
                  {pending.message}
                </p>
              )}
              <div className="actions dialog-actions">
                <button type="button" className="secondary" onClick={() => close(false)}>
                  {pending.cancelLabel ?? t('common.cancel')}
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className={pending.danger ? 'danger solid' : 'primary'}
                  onClick={() => close(true)}
                >
                  {pending.confirmLabel ?? t('common.confirm')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
