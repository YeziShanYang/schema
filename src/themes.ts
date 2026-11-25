/**
 * Theme catalog and light/dark switching. Schema has one theme, Blueprint
 * (light tokens in styles.css, dark ones in themes.css). Dark mode is the
 * `dark` class on <html>. The inline script in index.html applies the
 * reader's stored choice, or else the system setting, before first paint;
 * this module keeps it in step afterwards, across open tabs too. It must
 * agree with that script on MODE_KEY, its values and THEME_COLOR.
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

/**
 * The phone browser bar's color for each mode: the top bars' card color.
 * index.html carries one theme-color meta per system scheme with these values.
 */
export const THEME_COLOR: Record<Mode, string> = { light: '#FFFFFF', dark: '#161C27' }

/** Point every theme-color meta at the mode on screen, so a picked mode wins over the system scheme's meta. */
function syncThemeColor(mode: Mode) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = THEME_COLOR[mode]
}

function systemMode(): Mode {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function show(mode: Mode) {
  // Synced even when the mode is already on screen: a pick that matches the system scheme still has to win once the system changes.
  syncThemeColor(mode)
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

/**
 * Until the reader picks, follow the system setting when it changes. A pick
 * made in another tab of this browser arrives as a `storage` event, and this
 * tab follows it (or the system setting, if the choice was cleared). Call
 * once at startup.
 */
export function followSystemMode() {
  if (typeof window === 'undefined') return
  window.addEventListener('storage', (e) => {
    if (e.key === MODE_KEY || e.key === null) show(storedMode() ?? systemMode())
  })
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia(DARK_QUERY).addEventListener('change', (e) => {
    if (!storedMode()) show(e.matches ? 'dark' : 'light')
  })
}
