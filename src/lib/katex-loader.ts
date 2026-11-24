/**
 * Loads KaTeX and its stylesheet (with fonts) on first use, so only pages
 * that show math pay for them.
 */
import type katexType from 'katex'

type Katex = typeof katexType

let loading: Promise<Katex> | null = null

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default)
  return loading
}

/** KaTeX output for one formula. Malformed math renders as its source in the error color. */
export function renderMath(katex: Katex, tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    errorColor: 'var(--color-destructive)',
    output: 'htmlAndMathml',
  })
}
