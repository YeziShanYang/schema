/**
 * Display titles for explainer links (a link whose title is missing or is
 * itself a URL shows its domain and path instead), and the title rule for
 * links stored without the pick call.
 */

import { contentWords } from './topics.ts'

/** "example.org/learn/softmax" from "https://www.example.org/learn/softmax/?x=1". */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let path = decodeURIComponent(u.pathname).replace(/\/+$/, '')
    if (path.length > 48) path = `${path.slice(0, 47)}…`
    return host + path
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

export function linkTitle(title: string | undefined, url: string): string {
  const t = (title ?? '').trim()
  if (!t || t === url || /^(https?:\/\/|www\.)\S+$/i.test(t)) return prettyUrl(url)
  return t
}

/** Content words a raw search result's title must share with the topic's name to be stored without the pick call. */
export const FALLBACK_SHARED_WORDS = 2

/**
 * Whether a raw search result can be stored as a topic's link when the pick
 * call failed (a link with no "why" line): its title must share at least two
 * content words with the topic's name. One shared word let in off-topic
 * pages, such as a number-guessing game for "Guessing probability and
 * identification".
 */
export function fallbackTitleFits(topicName: string, title: string): boolean {
  const words = contentWords(topicName)
  let shared = 0
  for (const w of contentWords(title)) if (words.has(w)) shared++
  return shared >= FALLBACK_SHARED_WORDS
}

export interface StoredLink {
  title: string
  url: string
  why?: string
}

/**
 * A topic's stored links that the current rule would not store: links with
 * no "why" line (raw results kept when the pick call failed) whose title
 * fails fallbackTitleFits. Used by scripts/migrations/clear-fallback-links.mjs.
 */
export function failingFallbackLinks(topicName: string, links: StoredLink[]): StoredLink[] {
  return links.filter((l) => !(l.why ?? '').trim() && !fallbackTitleFits(topicName, l.title))
}
