/**
 * Which quote a concept card shows. The concepts call returns up to two
 * candidate passages per concept; the server takes the first one that:
 * - is verified against the paper text (lib/quotes),
 * - has at least 8 words outside its math,
 * - contains no "=" (or another definition sign) and no display math,
 * - doesn't end in a lead-in ("is", "the", "as follows", a colon or a comma,
 *   or an equation reference such as "gives (9)") or start mid-clause
 *   ("and decreasing it thereafter ..."),
 * - has its brackets and parentheses closed,
 * - doesn't stop where the paper's sentence goes on into what the quote is
 *   leading up to (clippedAt): math, an equation reference, a colon, or the
 *   main clause or verb the quote's words belong to. Such a quote is
 *   extended to the end of the paper's sentence when the longer quote passes
 *   every rule; a quote that stops inside a bracket is extended the same way,
 * - and isn't used by another concept in the same paper.
 * When none passes, the concept has no quote and the card hides the block.
 * A quote that matches the paper exactly is stored as the paper's own text
 * (exactQuoteSpan), so its math keeps the paper's LaTeX delimiters.
 */

import { exactQuoteRange, isQuoteVerified, normalizeForMatch, spanText, type PaperIndex, type QuoteRange } from './quotes'
import { sentenceEnd } from './sentences'

export const MIN_QUOTE_WORDS = 8
/** Longest quote a card shows: the cap on a model's candidate, and on a quote extended to its sentence end. */
export const MAX_QUOTE_CHARS = 600

export type QuoteProblem =
  | 'empty'
  | 'unverified'
  | 'short'
  | 'equation'
  | 'display-math'
  | 'lead-in'
  | 'fragment'
  | 'unbalanced'
  | 'clipped'
  | 'duplicate'

/** Lowercase words a quote can't start on: it would begin in the middle of a clause. */
const FRAGMENT_STARTS = /^(?:and|or|but|nor|which|that|where|whereas|while|so|then|thereafter|thus|hence)\b/

/** Words a quote may not end on: the sentence would go on into a formula or a list. */
const LEAD_IN_WORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'the', 'a', 'an', 'as', 'follows', 'of', 'to', 'by', 'where', 'with', 'and', 'or', 'that',
  'which', 'than', 'for', 'from', 'in', 'on', 'into', 'namely', 'given', 'defined',
])

/** A closing reference to a numbered equation, which the card can't show: "(9)", "Eq. (9)", "Equation 12". */
const EQUATION_REFERENCE = /(?:\(\s*(?:[A-Z]\.)?\d{1,3}[a-z]?\s*\)|\b(?:eqs?|equations?)\.?\s*\(?\s*\d{1,3}[a-z]?\s*\)?)\s*[.!?]?["'”’]*$/i

const DEFINITION_SIGNS = /=|≔|≡|≜|\\coloneqq|\\eqqcolon|\\equiv|\\triangleq|\\stackrel/
const DISPLAY_MATH = /\\\[|\$\$|\\begin\{(?:equation|align|gather|multline|eqnarray)/

/** Openers of a clause that comes before its sentence's main clause ("Since ..., we ..."). */
const SUBORDINATE_OPENERS = /^(?:since|because|if|when|whenever|while|although|though|unless|until|once|after|before|given|in order|to|for (?:every|each|all|any))\b/i
/** A comma followed by the start of a main clause. */
const MAIN_CLAUSE_AFTER_COMMA = /^,\s*(?:we|it|they|this|these|those|the|a|an|our|its|their|there|one|each|every|all|no)\b/i
/** Words that begin a new clause or phrase: a quote stopping right before one isn't cut short. */
const CLAUSE_WORDS = new Set([
  'that', 'which', 'who', 'whom', 'whose', 'where', 'when', 'while', 'whereas', 'and', 'or', 'but', 'nor', 'so', 'because',
  'since', 'although', 'though', 'if', 'unless', 'as', 'than', 'then', 'thus', 'hence', 'to', 'until', 'after', 'before',
])
/** Verbs whose subject a quote often stops on ("the optimal error exponent | at fixed type-I error equals ..."). */
const MAIN_VERBS = new Set([
  'is', 'are', 'was', 'were', 'equals', 'equal', 'gives', 'give', 'yields', 'yield', 'holds', 'hold', 'becomes', 'become',
  'satisfies', 'satisfy', 'implies', 'imply', 'remains', 'remain', 'means', 'depends', 'determines', 'tends', 'converges',
  'coincides', 'matches', 'reduces', 'scales', 'grows', 'decays', 'vanishes', 'exceeds', 'has', 'have', 'can', 'cannot',
  'must', 'will', 'would', 'should', 'may', 'might', 'does', 'do', 'follows', 'admits', 'attains', 'achieves', 'requires',
])

/** The quote without its inline math, for counting words and finding its last word. */
function prose(quote: string): string {
  return quote.replace(/\\\([\s\S]*?\\\)/g, ' ').replace(/\$[^$]+\$/g, ' ')
}

export function wordCount(quote: string): number {
  return prose(quote).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length
}

/** True when the quote stops right before the thing it introduces, or on a reference to an equation it doesn't show. */
export function endsInLeadIn(quote: string): boolean {
  const t = quote.trim()
  if (/[:,;—–-]["'”’)]*$/.test(t)) return true
  if (EQUATION_REFERENCE.test(prose(t))) return true
  if (/\\\)\s*$/.test(t)) return false
  const last = prose(t).trim().replace(/["'”’).!?]+$/, '').split(/\s+/).pop() ?? ''
  return LEAD_IN_WORDS.has(last.toLowerCase())
}

/** True when a bracket or parenthesis in the quote's prose (its math aside) is never closed, or closes one the quote never opened. */
export function unbalanced(quote: string): boolean {
  let paren = 0
  let square = 0
  for (const ch of prose(quote)) {
    if (ch === '(') paren++
    else if (ch === ')' && --paren < 0) return true
    else if (ch === '[') square++
    else if (ch === ']' && --square < 0) return true
  }
  return paren !== 0 || square !== 0
}

/** Index of the bracket that closes the one `s` opens with, or -1 within the first 400 characters. */
function closingBracket(s: string): number {
  let depth = 0
  for (let i = 0; i < Math.min(s.length, 400); i++) {
    if (s[i] === '(' || s[i] === '[') depth++
    else if ((s[i] === ')' || s[i] === ']') && --depth === 0) return i
    else if (s[i] === '\n') return -1
  }
  return -1
}

/**
 * True when the paper's sentence goes on past a quote that ends at `end` in
 * the raw text, and what comes next is what the quote leads up to: math
 * (inline, after at most three words such as "given by", or display math
 * starting the next line), a colon, the main clause after an opening clause
 * ("Since ..., | we must ..."), or a verb whose subject the quote ends on.
 * A "[" or "(" right after the quote is looked past (a citation the quote
 * left out is not a cut), unless it is an equation reference or never closes.
 */
export function clippedAt(raw: string, end: number, quote: string): boolean {
  const q = quote.trim()
  if (/[.!?]["'”’)\]]*$/.test(q)) return false
  let after = raw.slice(end).replace(/^[ \t]+/, '')
  while (after[0] === '(' || after[0] === '[') {
    const close = closingBracket(after)
    if (close === -1 || /^\(\s*\d{1,3}[a-z]?\s*\)$/.test(after.slice(0, close + 1))) return true
    after = after.slice(close + 1).replace(/^[ \t]+/, '')
  }
  if (!after) return false
  if (after[0] === '\n') return /^\s*\\\[/.test(after)
  if (/^[.!?;]/.test(after)) return false
  if (/^(?:\\[([]|\$|:)/.test(after)) return true
  if (after[0] === ',') return SUBORDINATE_OPENERS.test(prose(q).trim()) && MAIN_CLAUSE_AFTER_COMMA.test(after)
  const lead = after.match(/^([^,;:.!?()[\]\\\n]*)\\\(/)
  if (lead && lead[1].split(/\s+/).filter(Boolean).length <= 3) return true
  const phrase = after.split(/[,;:.!?()[\]\n]|\\\(/)[0]
  for (const w of phrase.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (CLAUSE_WORDS.has(w)) return false
    if (MAIN_VERBS.has(w)) return true
  }
  return false
}

/**
 * Why a candidate quote can't be shown, or null when it can. `used` holds
 * normalized quotes other concepts took. Given the paper as a PaperIndex
 * (not only its normalized text), a quote that matches it exactly is also
 * checked against what the paper says right after it (clippedAt).
 */
export function quoteProblem(quote: string, paper: PaperIndex | string, used: ReadonlySet<string>): QuoteProblem | null {
  const q = quote.trim()
  if (!q) return 'empty'
  if (DISPLAY_MATH.test(q)) return 'display-math'
  if (DEFINITION_SIGNS.test(q)) return 'equation'
  if (wordCount(q) < MIN_QUOTE_WORDS) return 'short'
  if (endsInLeadIn(q)) return 'lead-in'
  if (FRAGMENT_STARTS.test(q)) return 'fragment'
  if (unbalanced(q)) return 'unbalanced'
  const norm = normalizeForMatch(q)
  for (const u of used) if (u === norm || u.includes(norm) || norm.includes(u)) return 'duplicate'
  const normalizedPaper = typeof paper === 'string' ? paper : paper.norm
  if (!isQuoteVerified(q, normalizedPaper)) return 'unverified'
  if (typeof paper !== 'string') {
    const range = exactQuoteRange(q, paper)
    if (range && clippedAt(paper.raw, range.end, q)) return 'clipped'
  }
  return null
}

/** The quote's range carried on to the end of its sentence in the paper, or null when that adds nothing or runs too long. */
function toSentenceEnd(index: PaperIndex, range: QuoteRange): string | null {
  const end = sentenceEnd(index.raw, range.end)
  if (end <= range.end) return null
  const text = spanText(index, { start: range.start, end })
  return text.length <= MAX_QUOTE_CHARS ? text : null
}

export interface QuotePick {
  quote: string
  rejected: { quote: string; problem: QuoteProblem }[]
  /** Set when the quote was a candidate that stopped short and was carried on to its sentence end: the candidate as given. */
  extendedFrom?: string
}

/**
 * The first candidate that passes every rule, in the paper's own words when
 * it matches exactly; adds it to `used`. Pass the paper as a PaperIndex to
 * get the exact text and the checks against the text that follows it, or as
 * a normalized string to keep the model's copy.
 */
export function pickQuote(candidates: string[], paper: PaperIndex | string, used: Set<string>): QuotePick {
  const index = typeof paper === 'string' ? null : paper
  const rejected: QuotePick['rejected'] = []
  for (const c of candidates) {
    const range = index ? exactQuoteRange(c, index) : null
    let candidate = index && range ? spanText(index, range) : c.trim()
    // The paper's span is checked too: widening to a whole formula can bring in an "=".
    let problem = quoteProblem(candidate, paper, used)
    let extendedFrom: string | undefined
    if ((problem === 'clipped' || problem === 'unbalanced') && index && range) {
      const longer = toSentenceEnd(index, range)
      if (longer && longer !== candidate && quoteProblem(longer, paper, used) === null) {
        extendedFrom = c
        candidate = longer
        problem = null
      }
    }
    if (problem) {
      rejected.push({ quote: c, problem })
      continue
    }
    used.add(normalizeForMatch(candidate))
    return extendedFrom ? { quote: candidate, rejected, extendedFrom } : { quote: candidate, rejected }
  }
  return { quote: '', rejected }
}

const DEPTH_RANK: Record<string, number> = { deep: 0, working: 1, skim: 2 }

/** The order concepts pick quotes in: deep concepts first, so a central idea gets the passage it shares with a foundation. */
export function quotePickOrder<T extends { depth: string }>(concepts: T[]): T[] {
  return concepts.map((c, i) => ({ c, i })).sort((a, b) => (DEPTH_RANK[a.c.depth] ?? 1) - (DEPTH_RANK[b.c.depth] ?? 1) || a.i - b.i).map(({ c }) => c)
}
