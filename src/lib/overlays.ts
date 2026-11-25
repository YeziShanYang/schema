/**
 * The app's open overlays (branch panels, the sign-in window, the mobile
 * menu), in the order they opened. Each listens for keys at the document
 * level, and only the top one acts on Esc and Tab, so Esc on a window
 * stacked over another closes just that window, wherever focus is.
 */

const stack: object[] = []

/** Adds an overlay to the top of the stack; the returned function removes it. */
export function pushOverlay(layer: object): () => void {
  stack.push(layer)
  return () => {
    const i = stack.lastIndexOf(layer)
    if (i >= 0) stack.splice(i, 1)
  }
}

export function isTopOverlay(layer: object): boolean {
  return stack[stack.length - 1] === layer
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keeps Tab and Shift+Tab inside `root`; focus outside it moves to its first control. */
export function trapTab(e: KeyboardEvent, root: HTMLElement) {
  const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!root.contains(document.activeElement)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
