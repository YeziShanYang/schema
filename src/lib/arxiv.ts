/**
 * arXiv identifier parsing, shared by the browser and the worker.
 *
 * Accepts new-style ids (2611.29002, 2611.29002v1, 1706.03762), old-style
 * ids (hep-th/9901001, math.AG/0601001v2) and abs/pdf/html URLs for either.
 * Returns the base id (no version) as the cache key, plus the version if one
 * was given.
 */

export interface ArxivRef {
  /** Base id without version, e.g. "2611.29002" or "hep-th/9901001". */
  id: string
  /** Version suffix such as "v2", or "" when none was given. */
  version: string
}

const NEW_STYLE = /^(\d{4}\.\d{4,5})(v\d+)?$/
const OLD_STYLE = /^([a-z-]+(?:\.[A-Za-z]{2})?\/\d{7})(v\d+)?$/
/** Ids starting with this prefix are synthetic fixtures, accepted only in local test runs. */
export const FIXTURE_PREFIX = '0000.'

export function parseArxivId(input: string): ArxivRef | null {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (!s || s.length > 300) return null

  // Strip a leading "arXiv:" label.
  s = s.replace(/^arxiv:\s*/i, '')

  // URLs: arxiv.org/abs/<id>, /pdf/<id>(.pdf), /html/<id>, export./www. hosts.
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+)$/i)
  if (url) {
    s = url[1]
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .replace(/\.pdf$/i, '')
  }

  const m = s.match(NEW_STYLE) ?? s.match(OLD_STYLE)
  if (!m) return null
  return { id: m[1], version: m[2] ?? '' }
}

/** URL-safe slug for routes. arXiv ids never contain "_", so this round-trips. */
export function arxivSlug(id: string): string {
  return id.replace(/\//g, '_')
}

export function arxivFromSlug(slug: string): string {
  return slug.replace(/_/g, '/')
}

export function arxivAbsUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`
}

export function arxivPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}`
}

export function isFixtureId(id: string): boolean {
  return id.startsWith(FIXTURE_PREFIX)
}
