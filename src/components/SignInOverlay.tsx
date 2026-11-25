/**
 * The SDK's sign-in window (AuthOverlay), titled for Schema, as a modal
 * layer: focus moves into it when it opens and Tab stays inside, Esc closes
 * it (and only it, when it sits over a branch panel), and focus returns to
 * the control that opened it. Portaled to the body, above any open panel.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AuthOverlay } from 'deepspace'
import { FOCUSABLE, isTopOverlay, pushOverlay, trapTab } from '../lib/overlays'

export function SignInOverlay({
  onClose,
  returnFocus,
}: {
  onClose: () => void
  /** Where focus goes on close; defaults to whatever had focus when the window opened. */
  returnFocus?: HTMLElement | null
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const returnRef = useRef(returnFocus)
  returnRef.current = returnFocus

  useEffect(() => {
    const layer = {}
    const pop = pushOverlay(layer)
    const opener = returnRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)

    // The window renders once the auth state has loaded, so focus its first control when it appears.
    const focusIn = () => {
      const root = rootRef.current
      const first = root?.querySelector<HTMLElement>(FOCUSABLE)
      if (!root || !first) return false
      if (!root.contains(document.activeElement)) first.focus()
      return true
    }
    let observer: MutationObserver | null = null
    if (!focusIn() && rootRef.current) {
      observer = new MutationObserver(() => focusIn() && observer?.disconnect())
      observer.observe(rootRef.current, { childList: true, subtree: true })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopOverlay(layer)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      } else if (e.key === 'Tab' && rootRef.current) {
        trapTab(e, rootRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      observer?.disconnect()
      document.removeEventListener('keydown', onKeyDown)
      pop()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Sign in to Schema" data-testid="sign-in-window">
      <AuthOverlay onClose={onClose} title="Sign in to Schema" description="Keep your workspaces and checkmarks on every device." />
    </div>,
    document.body,
  )
}
