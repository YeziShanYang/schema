/**
 * Theme catalog. Schema has one light theme, Blueprint (tokens in styles.css).
 */

export const THEMES = [
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'Dot-grid canvas, IBM Plex Sans with Plex Mono labels, square corners, dashed elbow links.',
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
