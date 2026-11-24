/**
 * Display titles for explainer links. A link whose title is missing or is
 * itself a URL shows its domain and path instead.
 */

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
