/**
 * Sentence boundaries in stored paper text, for the quote rules: where the
 * sentence a quote stops inside ends, and which sentences name a concept.
 *
 * A sentence ends at ".", "!" or "?" (with any closing quote or bracket)
 * followed by white space and a word that doesn't start in lowercase, or at
 * a line break. Math between \( \) or \[ \] is never split, and a period
 * after a common abbreviation ("et al.", "Fig.", "e.g.") or a one-letter
 * initial doesn't end a sentence.
 */

export interface Sentence {
  start: number
  end: number
  text: string
}

const ABBREVIATIONS = new Set([
  'al', 'e.g', 'i.e', 'cf', 'fig', 'figs', 'eq', 'eqs', 'sec', 'secs', 'ref', 'refs', 'resp', 'vs', 'thm', 'lem', 'prop',
  'cor', 'def', 'defn', 'no', 'approx', 'ch', 'app', 'tab', 'viz', 'etc', 'ca', 'pp',
])

const CLOSERS = new Set(['"', '”', '’', "'", ')', ']'])

/** Index just past the math that opens at `i` (\( or \[), or i + 2 when it never closes. */
function skipMath(raw: string, i: number): number {
  const close = raw[i + 1] === '(' ? '\\)' : '\\]'
  const at = raw.indexOf(close, i + 2)
  return at === -1 ? i + 2 : at + 2
}

/** True when the period at `i` closes an abbreviation or an initial rather than a sentence. */
function abbreviationAt(raw: string, i: number): boolean {
  const word = raw.slice(Math.max(0, i - 12), i).match(/([A-Za-z][A-Za-z.]*)$/)?.[1] ?? ''
  if (/^[A-Z]$/.test(word)) return true
  return ABBREVIATIONS.has(word.toLowerCase())
}

/** Index just past the end of the sentence that contains position `from`: its closing punctuation, or the line break. */
export function sentenceEnd(raw: string, from: number): number {
  let i = from
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\' && (raw[i + 1] === '(' || raw[i + 1] === '[')) {
      i = skipMath(raw, i)
      continue
    }
    if (ch === '\n') return i
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1
      while (j < raw.length && CLOSERS.has(raw[j])) j++
      const next = raw.slice(j).match(/^[ \t]+(\S)/)?.[1]
      const atBreak = j >= raw.length || raw[j] === '\n'
      if ((atBreak || (next && !/\p{Ll}/u.test(next))) && !(ch === '.' && abbreviationAt(raw, i))) return j
    }
    i++
  }
  return raw.length
}

/** The text's sentences in order, with their offsets; blank lines are skipped. */
export function paperSentences(raw: string): Sentence[] {
  const out: Sentence[] = []
  let i = 0
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i++
    if (i >= raw.length) break
    const end = sentenceEnd(raw, i)
    const text = raw.slice(i, end).trim()
    if (text) out.push({ start: i, end, text })
    i = Math.max(end, i + 1)
  }
  return out
}

/** The first sentence of a short text, such as a concept's why-needed line. */
export function firstSentence(text: string): string {
  return paperSentences(text.trim())[0]?.text ?? ''
}
