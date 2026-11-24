/**
 * Paper metadata from the free public arXiv API (no key, no integration).
 * https://info.arxiv.org/help/api/user-manual.html
 */

import { isFixtureId } from '../../lib/arxiv'
import { FIXTURE_META } from './fixtures'

export interface ArxivMeta {
  id: string
  version: string
  title: string
  authors: string[]
  abstract: string
  primaryCategory: string
  publishedAt: string
}

export type ArxivLookup =
  | { ok: true; meta: ArxivMeta }
  | { ok: false; reason: 'not_found' | 'unreachable'; message: string }

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1]).replace(/\s+/g, ' ').trim() : ''
}

/** Parse one arXiv Atom response. Exported for unit tests. */
export function parseArxivAtom(xml: string, requestedId: string): ArxivMeta | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)
  if (!entry) return null
  const e = entry[1]
  const idUrl = tag(e, 'id')
  const title = tag(e, 'title')
  if (!idUrl.includes('arxiv.org/abs/') || !title || title.toLowerCase() === 'error') return null
  const absId = idUrl.split('arxiv.org/abs/')[1] ?? ''
  const versionMatch = absId.match(/(v\d+)$/)
  if (!absId.replace(/v\d+$/, '').endsWith(requestedId)) return null
  const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => decodeXml(m[1]).trim())
  const cat = e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)
  return {
    id: requestedId,
    version: versionMatch ? versionMatch[1] : '',
    title,
    authors: authors.slice(0, 30),
    abstract: tag(e, 'summary'),
    primaryCategory: cat ? cat[1] : '',
    publishedAt: tag(e, 'published'),
  }
}

export async function lookupArxiv(id: string, opts: { fixtures: boolean }): Promise<ArxivLookup> {
  if (opts.fixtures && isFixtureId(id)) {
    return { ok: true, meta: { ...FIXTURE_META, id } }
  }
  let res: Response
  try {
    res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`, {
      headers: { 'User-Agent': 'Schema/1.0 (https://schema.app.space)' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ok: false, reason: 'unreachable', message: "Couldn't reach arXiv. Try again in a minute." }
  }
  if (!res.ok) {
    return { ok: false, reason: 'unreachable', message: `arXiv answered ${res.status}. Try again in a minute.` }
  }
  const meta = parseArxivAtom(await res.text(), id)
  if (!meta) {
    return { ok: false, reason: 'not_found', message: `arXiv has no paper with id ${id}.` }
  }
  return { ok: true, meta }
}
