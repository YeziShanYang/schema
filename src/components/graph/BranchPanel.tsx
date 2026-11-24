/**
 * Wide centered panel over the dimmed graph (not a sidebar): about 960px
 * wide, full width under 760px, its body scrolling inside with overscroll
 * contained. Esc, the close button and a click on the backdrop dismiss it.
 * Focus moves into the panel on open, stays inside while it is open, and
 * returns to the element that opened it on close. The exit runs 150ms before
 * the panel unmounts.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '../icons'

const EXIT_MS = 150

export function BranchPanel({
  open,
  onClose,
  returnFocus,
  title,
  eyebrow,
  description,
  header,
  children,
  testId = 'branch-panel',
  closeLabel = 'Close branch',
  maxWidth = 960,
}: {
  open: boolean
  onClose: () => void
  returnFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null)
  title: string
  eyebrow?: ReactNode
  description?: string
  header?: ReactNode
  children: ReactNode
  testId?: string
  closeLabel?: string
  maxWidth?: number
}) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
      const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus?.current
      target?.focus()
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [open]) // only `open` drives the exit

  // Focus moves into the panel when it opens, and again when its content
  // switches (a chip can open another branch and remove the focused element).
  useEffect(() => {
    if (open && mounted && !panelRef.current?.contains(document.activeElement)) closeRef.current?.focus()
  }, [open, mounted, title])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault()
        closeRef.current?.focus()
        return
      }
      // Keep focus inside the panel while it is open.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  // Keys are handled at the document level so Esc works wherever focus is.
  useEffect(() => {
    if (!open || !mounted) return
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, mounted, onKeyDown])

  // Lock page scroll behind the panel.
  useEffect(() => {
    if (!mounted) return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [mounted])

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-0 pt-0 min-[760px]:px-6 min-[760px]:pt-[6vh]">
      <div
        className="panel-backdrop absolute inset-0 bg-[rgba(15,23,42,0.38)]"
        data-closing={closing}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        data-closing={closing}
        style={{ maxWidth }}
        className="branch-panel relative flex h-full w-full flex-col overflow-hidden border border-transparent bg-card shadow-[var(--shadow-ring-hi),0_24px_64px_rgba(15,23,42,0.18)] min-[760px]:h-auto min-[760px]:max-h-[86vh] min-[760px]:rounded-lg"
      >
        <div className="border-b border-border px-5 pb-3.5 pt-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <div className="label">{eyebrow}</div>}
              <h2 id={`${testId}-title`} className="mt-1 text-[21px] font-semibold leading-tight">{title}</h2>
              {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              data-testid="panel-close"
              className="press grid size-[30px] shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              <CloseIcon size={16} />
            </button>
          </div>
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
