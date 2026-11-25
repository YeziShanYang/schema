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

/** The paper text normalized like normalizeForMatch, with the raw index of every normalized character. */
export interface PaperIndex {
  raw: string
  norm: string
  rawAt: Int32Array
}

export function indexPaperText(raw: string): PaperIndex {
  const out: string[] = []
  const at: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const folded = (LIGATURES[ch] ?? ch).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (const f of folded) {
      if (/[a-z0-9]/.test(f)) {
        out.push(f)
        at.push(i)
      }
    }
  }
  return { raw, norm: out.join(''), rawAt: Int32Array.from(at) }
}

/**
 * The paper's own text for a quote that matches it exactly (after
 * normalization), so a model's copying slips (dropped math delimiters, a
 * changed dash) never reach the card. A span that starts or ends inside a
 * formula is widened to the whole formula, and the quote's closing
 * punctuation is kept. Null when the quote is not an exact match.
 */
export function exactQuoteSpan(quote: string, index: PaperIndex): string | null {
  const range = exactQuoteRange(quote, index)
  return range ? spanText(index, range) : null
}

/** Raw offsets [start, end) of a quote's exact match, widened as exactQuoteSpan describes. */
export interface QuoteRange {
  start: number
  end: number
}

/** The paper's text for a range, on one line. */
export function spanText(index: PaperIndex, range: QuoteRange): string {
  return index.raw.slice(range.start, range.end).replace(/\s+/g, ' ').trim()
}

export function exactQuoteRange(quote: string, index: PaperIndex): QuoteRange | null {
  const q = normalizeForMatch(quote)
  if (q.length < 12) return null
  const pos = index.norm.indexOf(q)
  if (pos === -1) return null
  const { raw } = index
  let start = index.rawAt[pos]
  let end = index.rawAt[pos + q.length - 1] + 1
  // Inside \( … \) or \[ … \] at either edge: take the whole formula.
  const lastOpen = (s: string) => Math.max(s.lastIndexOf('\\('), s.lastIndexOf('\\['))
  const lastClose = (s: string) => Math.max(s.lastIndexOf('\\)'), s.lastIndexOf('\\]'))
  const before = raw.slice(0, start)
  if (lastOpen(before) > lastClose(before)) start = lastOpen(before)
  const span = raw.slice(start, end)
  if (lastOpen(span) > lastClose(span)) {
    const close = raw.slice(end).search(/\\[)\]]/)
    if (close !== -1) end += close + 2
  }
  const trailing = quote.trim().match(/[.!?;,:]$/)?.[0]
  if (trailing && raw[end] === trailing) end += 1
  return { start, end }
}
