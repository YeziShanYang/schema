/**
 * Theme catalog and light/dark switching. Schema has one theme, Blueprint
 * (light tokens in styles.css, dark ones in themes.css). Dark mode is the
 * `dark` class on <html>. The inline script in index.html applies the
 * reader's stored choice, or else the system setting, before first paint;
 * this module keeps it in step afterwards. It must agree with that script
 * on MODE_KEY and its values.
 */

export const THEMES = [
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'Dot-grid canvas, IBM Plex Sans with Plex Mono labels, square corners, dashed elbow links. Light and dark.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export function getActiveTheme(): ThemeId {
  return 'blueprint'
}

export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * Apply a change that would restyle the page (a theme swap) with every
 * transition suppressed, so colors do not smear: add the override, apply,
 * force a style flush, and remove it after the next frame.
 */
export function withoutTransitions(apply: () => void): void {
  const root = document.documentElement
  root.classList.add('no-transitions')
  apply()
  void root.offsetHeight
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transitions')))
}

export type Mode = 'light' | 'dark'

/** localStorage key for the reader's choice, per browser. Absent until they pick. */
export const MODE_KEY = 'schema:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The stored choice; null when the reader never picked or storage is unavailable. */
export function storedMode(): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** The mode on screen now. */
export function currentMode(): Mode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const listeners = new Set<() => void>()

/** For useSyncExternalStore: called whenever the mode on screen changes. */
export function subscribeMode(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

function show(mode: Mode) {
  if (currentMode() === mode) return
  withoutTransitions(() => document.documentElement.classList.toggle('dark', mode === 'dark'))
  for (const l of listeners) l()
}

/** The reader picked a mode: show it and remember it in this browser. */
export function chooseMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
  show(mode)
}

/** Until the reader picks, follow the system setting when it changes. Call once at startup. */
export function followSystemMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  window.matchMedia(DARK_QUERY).addEventListener('change', (e) => {
    if (!storedMode()) show(e.matches ? 'dark' : 'light')
  })
}
