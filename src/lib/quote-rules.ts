/**
 * Which quote a concept card shows. The concepts call returns up to two
 * candidate passages per concept; the server takes the first one that:
 * - is verified against the paper text (lib/quotes),
 * - has at least 8 words outside its math,
 * - contains no "=" (or another definition sign) and no display math,
 * - doesn't end in a lead-in ("is", "the", "as follows", a colon or a comma)
 *   or start mid-clause ("and decreasing it thereafter ..."),
 * - and isn't used by another concept in the same paper.
 * When none passes, the concept has no quote and the card hides the block.
 * A quote that matches the paper exactly is stored as the paper's own text
 * (exactQuoteSpan), so its math keeps the paper's LaTeX delimiters.
 */

import { exactQuoteSpan, isQuoteVerified, normalizeForMatch, type PaperIndex } from './quotes'

export const MIN_QUOTE_WORDS = 8

export type QuoteProblem = 'empty' | 'unverified' | 'short' | 'equation' | 'display-math' | 'lead-in' | 'fragment' | 'duplicate'

/** Lowercase words a quote can't start on: it would begin in the middle of a clause. */
const FRAGMENT_STARTS = /^(?:and|or|but|nor|which|that|where|whereas|while|so|then|thereafter|thus|hence)\b/

/** Words a quote may not end on: the sentence would go on into a formula or a list. */
const LEAD_IN_WORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'the', 'a', 'an', 'as', 'follows', 'of', 'to', 'by', 'where', 'with', 'and', 'or', 'that',
  'which', 'than', 'for', 'from', 'in', 'on', 'into', 'namely', 'given', 'defined',
])

const DEFINITION_SIGNS = /=|≔|≡|≜|\\coloneqq|\\eqqcolon|\\equiv|\\triangleq|\\stackrel/
const DISPLAY_MATH = /\\\[|\$\$|\\begin\{(?:equation|align|gather|multline|eqnarray)/

/** The quote without its inline math, for counting words and finding its last word. */
function prose(quote: string): string {
  return quote.replace(/\\\([\s\S]*?\\\)/g, ' ').replace(/\$[^$]+\$/g, ' ')
}

export function wordCount(quote: string): number {
  return prose(quote).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length
}

/** True when the quote stops right before the thing it introduces. */
export function endsInLeadIn(quote: string): boolean {
  const t = quote.trim()
  if (/[:,;—–-]["'”’)]*$/.test(t)) return true
  if (/\\\)\s*$/.test(t)) return false
  const last = prose(t).trim().replace(/["'”’).!?]+$/, '').split(/\s+/).pop() ?? ''
  return LEAD_IN_WORDS.has(last.toLowerCase())
}

/** Why a candidate quote can't be shown, or null when it can. `used` holds normalized quotes other concepts took. */
export function quoteProblem(quote: string, normalizedPaper: string, used: ReadonlySet<string>): QuoteProblem | null {
  const q = quote.trim()
  if (!q) return 'empty'
  if (DISPLAY_MATH.test(q)) return 'display-math'
  if (DEFINITION_SIGNS.test(q)) return 'equation'
  if (wordCount(q) < MIN_QUOTE_WORDS) return 'short'
  if (endsInLeadIn(q)) return 'lead-in'
  if (FRAGMENT_STARTS.test(q)) return 'fragment'
  const norm = normalizeForMatch(q)
  for (const u of used) if (u === norm || u.includes(norm) || norm.includes(u)) return 'duplicate'
  if (!isQuoteVerified(q, normalizedPaper)) return 'unverified'
  return null
}

export interface QuotePick {
  quote: string
  rejected: { quote: string; problem: QuoteProblem }[]
}

/**
 * The first candidate that passes every rule, in the paper's own words when
 * it matches exactly; adds it to `used`. Pass the paper as a PaperIndex to
 * get the exact text, or as a normalized string to keep the model's copy.
 */
export function pickQuote(candidates: string[], paper: PaperIndex | string, used: Set<string>): QuotePick {
  const normalizedPaper = typeof paper === 'string' ? paper : paper.norm
  const rejected: QuotePick['rejected'] = []
  for (const c of candidates) {
    const exact = typeof paper === 'string' ? null : exactQuoteSpan(c, paper)
    const candidate = exact ?? c.trim()
    // The paper's span is checked too: widening to a whole formula can bring in an "=".
    const problem = quoteProblem(candidate, normalizedPaper, used)
    if (problem) {
      rejected.push({ quote: c, problem })
      continue
    }
    used.add(normalizeForMatch(candidate))
    return { quote: candidate, rejected }
  }
  return { quote: '', rejected }
}

const DEPTH_RANK: Record<string, number> = { deep: 0, working: 1, skim: 2 }

/** The order concepts pick quotes in: deep concepts first, so a central idea gets the passage it shares with a foundation. */
export function quotePickOrder<T extends { depth: string }>(concepts: T[]): T[] {
  return concepts.map((c, i) => ({ c, i })).sort((a, b) => (DEPTH_RANK[a.c.depth] ?? 1) - (DEPTH_RANK[b.c.depth] ?? 1) || a.i - b.i).map(({ c }) => c)
}
