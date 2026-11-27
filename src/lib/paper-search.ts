/**
 * Search by name in the "Open a paper" box (AnalyzeForm), with no React in
 * it. Text that is not an arXiv link or id is matched against the papers
 * already analyzed: every word typed must appear, ignoring case and accents,
 * in the title, an author's name or the arXiv id. Papers whose title holds
 * every word come first, then those whose title holds some of them, then
 * the rest; within each group, more words matching at the start of a title
 * word ranks higher, and ties keep the order the papers were passed in.
 */

import { parseArxivId } from './arxiv'

export interface SearchablePaper {
  arxivId: string
  title: string
  authors?: readonly string[] | null
  status: string
}

/** The most results the box lists. */
export const SEARCH_LIMIT = 6

/** Lowercase, without accents, so "Schölkopf" matches "scholkopf". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The words of a query, folded. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** Whether the box searches by name: the text is not an arXiv link or id and has at least 2 non-space characters. */
export function isNameSearch(input: string): boolean {
  return !parseArxivId(input) && input.replace(/\s/g, '').length >= 2
}

/** Whether `word` starts a word of `text` (both folded): at the start, or after a character that is not a letter or digit. */
function startsWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true
  }
  return false
}

/** The ready papers that match every word of `query`, best first, at most `limit` of them. */
export function matchPapers<T extends SearchablePaper>(papers: readonly T[], query: string, limit = SEARCH_LIMIT): T[] {
  const words = searchWords(query)
  if (!words.length) return []
  const scored: { paper: T; group: number; starts: number; index: number }[] = []
  papers.forEach((paper, index) => {
    if (paper.status !== 'ready') return
    const title = fold(paper.title ?? '')
    const rest = fold(`${(paper.authors ?? []).join(' ')} ${paper.arxivId}`)
    let inTitle = 0
    let starts = 0
    for (const w of words) {
      if (title.includes(w)) {
        inTitle++
        if (startsWord(title, w)) starts++
      } else if (!rest.includes(w)) return
    }
    const group = inTitle === words.length ? 0 : inTitle > 0 ? 1 : 2
    scored.push({ paper, group, starts, index })
  })
  return scored
    .sort((a, b) => a.group - b.group || b.starts - a.starts || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.paper)
}

/** "Vaswani" for one author, "Vaswani et al." for more, "" for none: the last word of the first author's name. */
export function shortAuthors(authors: readonly string[] | null | undefined): string {
  const first = authors?.[0]?.trim()
  if (!first) return ''
  const last = first.split(/\s+/).slice(-1)[0]
  return authors!.length > 1 ? `${last} et al.` : last
}
