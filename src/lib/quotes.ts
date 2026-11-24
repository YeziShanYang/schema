/**
 * Checks that a model-supplied quote really appears in the paper text.
 *
 * Both sides are folded to lowercase ASCII letters and digits (ligatures
 * expanded, accents removed, words hyphenated across lines rejoined), so PDF
 * extraction noise does not count as a mismatch. An exact substring scores 1.
 * Otherwise the quote is cut into fixed-size chunks and the score is the share
 * of chunks found. That keeps the check linear-time with native indexOf, which
 * matters inside a Worker with a CPU budget.
 */

const LIGATURES: Record<string, string> = {
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬀ': 'ff',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  '­': '',
}

export function normalizeForMatch(s: string): string {
  let out = s
  for (const [k, v] of Object.entries(LIGATURES)) out = out.split(k).join(v)
  out = out.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  out = out.replace(/-\s*\n\s*/g, '')
  return out.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const CHUNK = 12

export function quoteScore(quote: string, normalizedPaper: string): number {
  const q = normalizeForMatch(quote)
  if (q.length === 0) return 0
  if (normalizedPaper.includes(q)) return 1
  if (q.length < CHUNK * 2) return 0
  let found = 0
  let total = 0
  for (let i = 0; i + CHUNK <= q.length; i += CHUNK) {
    total++
    if (normalizedPaper.includes(q.slice(i, i + CHUNK))) found++
  }
  return total === 0 ? 0 : found / total
}

/** A quote counts as verified when it matches exactly or most of its chunks are present. */
export const QUOTE_VERIFIED_THRESHOLD = 0.6

export function isQuoteVerified(quote: string, normalizedPaper: string): boolean {
  return quoteScore(quote, normalizedPaper) >= QUOTE_VERIFIED_THRESHOLD
}
