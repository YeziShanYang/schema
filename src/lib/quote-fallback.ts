/**
 * A quote found without a model call, for a concept none of whose candidate
 * quotes passed the rules: the first sentence of the stored paper text that
 * names the concept and passes the same rules as a model candidate
 * (pickQuote), so it is verified the same way and never repeats another
 * concept's quote.
 *
 * Names are tried in this order, each against every sentence in paper order:
 * 1. the concept's name, then its topic's name;
 * 2. abbreviations: a parenthetical in either name that is one ("Close Image
 *    to Uniform (CIUniform)"), then one the paper defines right after either
 *    name ("embodied conversational agent (ECA)");
 * 3. shorter forms of either name: without its parenthetical, the head before
 *    a preposition ("Bellman recursion" for "Bellman recursion for a priced
 *    query"), each side of an "and" that has two or more words ("Spearman
 *    rank correlation"), and a two-word name without its generic head noun
 *    ("Hessian" for "Hessian matrix", a content word of four or more
 *    letters). A shorter form is never another concept's name.
 * Matching ignores case (except in abbreviations), plurals, hyphens and the
 * difference between straight and curly quote marks ("Hilbert's" matches
 * "Hilbert’s"), and looks at a sentence's prose only, not its math. A card
 * shows the sentence on its own, so three kinds are skipped: a line that
 * doesn't end like a sentence (a table row, heading, title or keyword list),
 * one with two or more citations ("(Mehta, 2004; ...)", "[12]"), which is
 * usually related work mentioning the idea in passing, and one that opens by
 * referring to the sentence before it ("This explains ...", "These results
 * ...", "To this end, ...", "It ...", "Thus ...").
 */

import { pickQuote, MAX_QUOTE_CHARS } from './quote-rules'
import type { PaperIndex } from './quotes'
import { indexSentences, type Sentence } from './sentences'
import { contentWords, normalizeConceptName } from './topics'

export type NameTermKind = 'name' | 'abbreviation' | 'short'

export interface NameTerm {
  text: string
  kind: NameTermKind
  re: RegExp
}

export interface QuoteSearch {
  index: PaperIndex
  sentences: (Sentence & { prose: string })[]
}

export interface NamedQuote {
  quote: string
  /** The name, abbreviation or shorter form the sentence contains. */
  term: string
  kind: NameTermKind
}

/** Words that start a modifier after a name's head ("Bellman recursion | for a priced query"). "to", "in" and "on" are left out: they are often part of the name itself ("Close Image to Uniform"). */
const PREPOSITIONS = new Set(['via', 'for', 'of', 'with', 'under', 'using', 'across', 'through'])

function stripMath(s: string): string {
  return s.replace(/\\\([\s\S]*?\\\)/g, ' ').replace(/\\\[[\s\S]*?\\\]/g, ' ').replace(/\$[^$]+\$/g, ' ').replace(/\s+/g, ' ').trim()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A word as a pattern that also matches its singular or plural. */
function wordPattern(word: string): string {
  const w = escape(word.toLowerCase())
  if (/^[a-z]{2,}ices$/.test(w)) return `${w.slice(0, -4)}(?:ix|ex|ices)`
  if (/^[a-z]{2,}(?:ix|ex)$/.test(w)) return `${w.slice(0, -2)}(?:ix|ex|ices)`
  if (/^[a-z]{2,}ies$/.test(w)) return `${w.slice(0, -3)}(?:y|ies)`
  if (/(?:ss|us|is)$/.test(w)) return `${w}(?:es)?`
  if (/^[a-z]{3,}s$/.test(w)) return `${w.slice(0, -1)}(?:s|es)?`
  if (/[a-z][^aeiou]y$/.test(w)) return `(?:${w}|${w.slice(0, -1)}ies)`
  if (/(?:x|ch|sh)$/.test(w)) return `${w}(?:es)?`
  if (/[a-z]$/.test(w)) return `${w}s?`
  return w
}

/** A pattern in which a straight or curly apostrophe matches either, and so does a straight or curly double quote. */
function anyQuoteMark(pattern: string): string {
  return pattern.replace(/['‘’ʼ]/g, "['‘’ʼ]").replace(/["“”]/g, '["“”]')
}

function termRegex(text: string, kind: NameTermKind): RegExp {
  const body =
    kind === 'abbreviation'
      ? escape(text)
      : text
          .split(/[\s\-‐‑–]+/)
          .filter(Boolean)
          .map(wordPattern)
          .join('[\\s\\-‐‑–]+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${anyQuoteMark(body)}(?![\\p{L}\\p{N}])`, kind === 'abbreviation' ? 'u' : 'iu')
}

const words = (s: string) => s.split(/\s+/).filter(Boolean)

function looksLikeAbbreviation(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(s) && (s.match(/[A-Z]/g)?.length ?? 0) >= 2
}

/** A shorter form is specific enough when it has two or more words, or is one content word of four or more letters. */
function specificEnough(form: string): boolean {
  const w = words(form)
  if (w.length >= 2) return true
  return w.length === 1 && w[0].length >= 4 && contentWords(w[0]).size === 1
}

/** The parenthetical at the end of a name ("Close Image to Uniform (CIUniform)") and the name without it. */
function splitParenthetical(name: string): { base: string; inner: string[] } {
  const m = name.match(/^(.*\S)\s+\(([^()]+)\)\s*$/)
  if (!m) return { base: name, inner: [] }
  return { base: m[1], inner: m[2].split(/\s*(?:,|\/|\band\b|\bor\b)\s*/).map((s) => s.trim()).filter(Boolean) }
}

/** The shorter forms of a name (see the file header), in the order they are tried. */
function shorterForms(name: string): string[] {
  const out: string[] = []
  const { base, inner } = splitParenthetical(name)
  if (base !== name) out.push(base)
  for (const part of inner) if (!looksLikeAbbreviation(part) && words(part).length >= 2) out.push(part)
  const w = words(base)
  // Only a whole two-word name drops its head noun: "Hessian" for "Hessian matrix", but not "transition" for "Transition matrices of random maps".
  if (w.length === 2 && contentWords(w[0]).size === 1 && contentWords(w[1]).size === 0) out.push(w[0])
  const cut = w.findIndex((x, i) => i >= 2 && PREPOSITIONS.has(x.toLowerCase()))
  const head = cut > 0 ? w.slice(0, cut).join(' ') : ''
  if (head) out.push(head)
  for (const phrase of [base, head].filter(Boolean)) {
    const parts = phrase.split(/\s*,\s*|\s+(?:and|or|versus|vs\.?)\s+/i).filter(Boolean)
    if (parts.length < 2) continue
    if (parts.length === 2 && words(parts[0]).length === 1 && words(parts[1]).length >= 2) {
      // "Tangent and normal spaces": "Tangent spaces" and "normal spaces".
      out.push(`${parts[0]} ${words(parts[1]).slice(1).join(' ')}`, parts[1])
    } else {
      out.push(...parts.filter((p) => words(p).length >= 2))
    }
  }
  return out
}

/**
 * The names a sentence may contain to count as naming a concept, in the
 * order they are tried. `otherNames` are the paper's other concept and topic
 * names, which shorter forms must not equal. `raw` is the paper text, for
 * abbreviations it defines.
 */
export function nameTerms(name: string, topicName: string, otherNames: string[] = [], raw = ''): NameTerm[] {
  const names = [stripMath(name), stripMath(topicName)].filter(Boolean)
  const taken = new Set(otherNames.map((n) => normalizeConceptName(stripMath(n))))
  const seen = new Set<string>()
  const out: NameTerm[] = []
  const add = (text: string, kind: NameTermKind) => {
    const t = text.trim()
    const key = kind === 'abbreviation' ? `abbr:${t}` : normalizeConceptName(t)
    if (!t || !key || seen.has(key)) return
    if (kind === 'short' && (taken.has(key) || !specificEnough(t))) return
    seen.add(key)
    out.push({ text: t, kind, re: termRegex(t, kind) })
  }
  for (const n of names) add(n, 'name')
  for (const n of names) for (const part of splitParenthetical(n).inner) if (looksLikeAbbreviation(part)) add(part, 'abbreviation')
  if (raw) {
    for (const n of names) {
      const base = splitParenthetical(n).base
      const re = new RegExp(`${termRegex(base, 'name').source}\\s*\\(([A-Za-z][A-Za-z0-9-]{1,15})[),;]`, 'giu')
      for (const m of raw.matchAll(re)) if (looksLikeAbbreviation(m[1])) add(m[1], 'abbreviation')
    }
  }
  for (const n of names) for (const form of shorterForms(n)) add(form, 'short')
  return out
}

/** The paper's sentences with their prose (math removed), for repeated searches. */
export function quoteSearch(index: PaperIndex): QuoteSearch {
  return { index, sentences: indexSentences(index).map((s) => ({ ...s, prose: stripMath(s.text) })) }
}

/** Nouns for the document itself: "This paper ..." and "In this section ..." don't lean on the sentence before. */
const DOCUMENT_NOUNS = '(?:paper|work|article|section|subsection|chapter|study|letter|note|thesis|manuscript|report|survey|appendix|review|tutorial)s?'
/** A demonstrative and the word after it, unless that word or the next one names the document ("This new paper"). */
const DEMONSTRATIVE = `(?:this|these|that|those)\\s+(?!(?:\\S+\\s+)?${DOCUMENT_NOUNS}\\b)\\S`

/** First words a demonstrative can follow and still open the sentence ("To this end", "Once this translation is done"). */
const OPENING_WORDS =
  '(?:to|for|in|on|at|by|with|from|under|as|of|once|when|after|before|since|because|if|while|although|though|given|unless|until|whereas)'

/**
 * Openings that lean on the sentence before: a pronoun subject, a connective,
 * or a demonstrative that opens the sentence or follows its first word ("This
 * consists of ...", "These results ...", "To this end, ...", "For this
 * reason, ...", "Once this translation is done, ...").
 */
const REFERS_BACK = new RegExp(
  '^(?:(?:it|they|such|hence|thus|therefore|then|consequently|accordingly)\\b' +
    `|${DEMONSTRATIVE}` +
    `|${OPENING_WORDS}\\s+(?:such\\s+\\S|${DEMONSTRATIVE}))`,
  'i',
)

/** A sentence's closing punctuation, with any closing quote or bracket after it. */
const SENTENCE_END = /[.!?]["'”’)\]]*$/

export function refersBack(prose: string): boolean {
  return REFERS_BACK.test(prose.trim())
}

/** Citations in a sentence's prose: author-year parentheticals ("(Sims, 2003; ...)", "Akemann et al. (2011)") and bracketed references ("[12]"). */
export function citationCount(prose: string): number {
  const authorYear = prose.match(/\([^()]*\b(?:1[6-9]|20)\d{2}[a-z]?\b[^()]*\)/g)?.length ?? 0
  const brackets = prose.match(/\[[^[\]]*[A-Za-z0-9][^[\]]*\]/g)?.length ?? 0
  return authorYear + brackets
}

/**
 * The first sentence that contains a term (trying terms in order) and passes
 * the quote rules, in the paper's words; adds it to `used`. Null when none does.
 */
export function findNamedQuote(terms: NameTerm[], search: QuoteSearch, used: Set<string>): NamedQuote | null {
  for (const term of terms) {
    for (const s of search.sentences) {
      if (s.text.length > MAX_QUOTE_CHARS || !term.re.test(s.prose) || !SENTENCE_END.test(s.text) || citationCount(s.prose) >= 2 || refersBack(s.prose)) continue
      const { quote } = pickQuote([s.text], search.index, used)
      if (quote) return { quote, term: term.text, kind: term.kind }
    }
  }
  return null
}
