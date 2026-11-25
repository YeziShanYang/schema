/**
 * Acceptance check for ConceptData.quoteDisplay, the verbatim quote with its
 * formulas rewritten as LaTeX. The words outside the math must still be the
 * quote's words: the prose words of the display (math removed) must nearly
 * all come from the quote, and the quote's longer words must nearly all
 * appear in the display, inside or outside the math. Both ratios must reach
 * 0.85; otherwise the verbatim quote is shown.
 */

import { hasMath, parseMath } from './math'

export const QUOTE_DISPLAY_MIN_OVERLAP = 0.85

function words(s: string): string[] {
  return s.normalize('NFKD').toLowerCase().match(/[a-z]{2,}/g) ?? []
}

/** min(precision, recall) of the display's words against the verbatim quote, 0 to 1. */
export function quoteDisplayOverlap(quote: string, display: string): number {
  const segments = parseMath(display)
  const prose = words(segments.filter((s) => s.type === 'text').map((s) => s.value).join(' '))
  const inMath = new Set(
    words(
      segments
        .filter((s) => s.type === 'math')
        .map((s) => s.value.replace(/\\[a-zA-Z]+/g, ' '))
        .join(' '),
    ),
  )
  const verbatim = words(quote)
  const have = new Set(verbatim)
  const shown = new Set(prose)
  const precision = prose.length ? prose.filter((w) => have.has(w)).length / prose.length : 1
  const long = verbatim.filter((w) => w.length >= 4)
  const recall = long.length ? long.filter((w) => shown.has(w) || inMath.has(w)).length / long.length : 1
  return Math.min(precision, recall)
}

/** Whether to show the LaTeX version: it has math and keeps the quote's words. */
export function acceptQuoteDisplay(quote: string, display: string): boolean {
  if (!quote || !display || display.trim() === quote.trim() || !hasMath(display)) return false
  return quoteDisplayOverlap(quote, display) >= QUOTE_DISPLAY_MIN_OVERLAP
}
