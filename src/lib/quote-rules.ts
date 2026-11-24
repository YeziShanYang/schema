/**
 * Which quote a concept card shows. The concepts call returns up to two
 * candidate passages per concept; the server takes the first one that:
 * - is verified against the paper text (lib/quotes),
 * - has at least 8 words outside its math,
 * - contains no "=" (or another definition sign) and no display math,
 * - doesn't end in a lead-in ("is", "the", "as follows", a colon or a comma),
 * - and isn't used by another concept in the same paper.
 * When none passes, the concept has no quote and the card hides the block.
 */

import { isQuoteVerified, normalizeForMatch } from './quotes'

export const MIN_QUOTE_WORDS = 8

export type QuoteProblem = 'empty' | 'unverified' | 'short' | 'equation' | 'display-math' | 'lead-in' | 'duplicate'

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
  const norm = normalizeForMatch(q)
  for (const u of used) if (u === norm || u.includes(norm) || norm.includes(u)) return 'duplicate'
  if (!isQuoteVerified(q, normalizedPaper)) return 'unverified'
  return null
}

export interface QuotePick {
  quote: string
  rejected: { quote: string; problem: QuoteProblem }[]
}

/** The first candidate that passes every rule; adds it to `used`. */
export function pickQuote(candidates: string[], normalizedPaper: string, used: Set<string>): QuotePick {
  const rejected: QuotePick['rejected'] = []
  for (const c of candidates) {
    const problem = quoteProblem(c, normalizedPaper, used)
    if (problem) {
      rejected.push({ quote: c, problem })
      continue
    }
    used.add(normalizeForMatch(c))
    return { quote: c.trim(), rejected }
  }
  return { quote: '', rejected }
}
