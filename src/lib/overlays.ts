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

/** Whether `a` comes before `b` in document order (or contains it). */
function before(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/**
 * Keeps Tab and Shift+Tab inside `root`; focus outside it moves to its first
 * control. Focus on an element outside the Tab order (a title with
 * tabindex -1) wraps too when it sits before the first control or after the
 * last.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement) {
  const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (!active || !root.contains(active)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && (active === first || before(active, first))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || before(last, active))) {
    e.preventDefault()
    first.focus()
  }
}
