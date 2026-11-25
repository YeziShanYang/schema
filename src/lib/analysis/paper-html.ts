/**
 * Turns an arXiv HTML paper (LaTeXML output, https://arxiv.org/html/<id>)
 * into plain text for the model, keeping the math as LaTeX. Each `<math>`
 * element becomes its `alttext` between \( and \), or between \[ and \] when
 * it is display math; a row of an equation table becomes one \[ … \] line.
 * Section headings stay on their own lines. The bibliography, appendices,
 * footnotes, the author block, the table of contents and the page chrome are
 * dropped, and every other tag is stripped to its text.
 *
 * A string tokenizer rather than a DOM, so it runs the same in a Worker and
 * in unit tests, in time linear in the page size.
 */

/** Below this many characters the HTML is treated as missing and the PDF is used instead. */
export const MIN_HTML_TEXT_CHARS = 4000

/** Elements dropped with everything inside them. */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'head',
  'nav',
  'header',
  'footer',
  'button',
  'dialog',
  'form',
  'svg',
  'object',
  'iframe',
  'template',
  'select',
  'textarea',
])

/** LaTeXML classes whose elements are dropped with everything inside them. */
const SKIP_CLASSES = [
  'ltx_bibliography',
  'ltx_appendix',
  'ltx_authors',
  'ltx_dates',
  'ltx_note',
  'ltx_TOC',
  'ltx_page_navbar',
  'ltx_page_header',
  'ltx_page_footer',
  'ltx_tag_equation',
  'ltx_tag_equationgroup',
]

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'table',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'caption',
])

const HEADING = /^h[1-6]$/

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  minus: '−',
  middot: '·',
  deg: '°',
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[body] ?? m
  })
}

/** Tags with their attributes (quoted values may contain `>`), comments, and the text between them. */
const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)|</g

const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(raw)) !== null) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

function hasClass(a: Record<string, string>, names: string[]): boolean {
  const cls = a.class
  if (!cls) return false
  const list = cls.split(/\s+/)
  return names.some((n) => list.includes(n))
}

/** LaTeX for one formula: alttext without layout-only commands, on one line. */
function cleanTex(tex: string): string {
  return tex
    .replace(/\\displaystyle\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The article part of the page; the arXiv chrome around it is not paper text. */
function articleOf(html: string): string {
  const start = html.search(/<article\b/i)
  if (start === -1) {
    const body = html.search(/<body\b/i)
    return body === -1 ? html : html.slice(body)
  }
  const end = html.lastIndexOf('</article>')
  return html.slice(start, end > start ? end + '</article>'.length : undefined)
}

export function arxivHtmlToText(html: string): string {
  const src = articleOf(html)
  const out: string[] = []

  // Skipping: the tag that started it and how deep we are in tags of that name.
  let skipTag = ''
  let skipDepth = 0
  // Inside <math>: its alttext and display mode, plus any TeX annotation as a fallback.
  let inMath = false
  let mathAlt = ''
  let mathBlock = false
  let mathAnnotation = ''
  let inAnnotation = false
  // Equation tables: the formulas of the current row, emitted as one display line.
  let eqnDepth = 0
  let eqnRow: string[] = []
  // Data tables: a separator between cells of a row.
  let cellsInRow = 0

  const emit = (s: string) => out.push(s)

  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(src)) !== null) {
    const [whole, slash, rawName, rawAttrs, selfClose, text] = m
    if (text !== undefined || whole === '<') {
      if (skipTag) continue
      const t = decodeEntities(text ?? whole)
      if (inMath) {
        if (inAnnotation) mathAnnotation += t
        continue
      }
      if (eqnDepth > 0) {
        const words = t.replace(/\s+/g, ' ').trim()
        if (words) eqnRow.push(`\\text{${words}}`)
        continue
      }
      emit(t.replace(/\s+/g, ' '))
      continue
    }
    if (!rawName) continue // comment, doctype, CDATA
    const name = rawName.toLowerCase()
    const closing = slash === '/'
    const isVoid = VOID_TAGS.has(name) || selfClose === '/'

    if (skipTag) {
      if (name !== skipTag || isVoid) continue
      skipDepth += closing ? -1 : 1
      if (skipDepth === 0) skipTag = ''
      continue
    }

    if (inMath) {
      if (name === 'annotation') {
        if (closing) inAnnotation = false
        else if (/tex/i.test(attrs(rawAttrs).encoding ?? '')) inAnnotation = true
      } else if (name === 'math' && closing) {
        inMath = false
        const tex = cleanTex(mathAlt || mathAnnotation)
        if (!tex) continue
        if (eqnDepth > 0) eqnRow.push(tex)
        else emit(mathBlock ? `\n\\[${tex}\\]\n` : `\\(${tex}\\)`)
      }
      continue
    }

    if (closing) {
      if (name === 'table' && eqnDepth > 0) {
        eqnDepth--
        if (eqnDepth === 0) emit('\n')
        continue
      }
      if (name === 'tr' && eqnDepth > 0) {
        if (eqnRow.length) emit(`\n\\[${eqnRow.join(' ')}\\]\n`)
        eqnRow = []
        continue
      }
      if (eqnDepth > 0) continue
      if (HEADING.test(name)) emit('\n')
      else if (BLOCK_TAGS.has(name)) emit('\n')
      continue
    }

    const a = attrs(rawAttrs)
    if (SKIP_TAGS.has(name) || hasClass(a, SKIP_CLASSES) || a.hidden !== undefined || a['aria-hidden'] === 'true') {
      if (!isVoid) {
        skipTag = name
        skipDepth = 1
      }
      continue
    }
    if (name === 'math') {
      if (isVoid) {
        const tex = cleanTex(a.alttext ?? '')
        if (tex) emit(a.display === 'block' ? `\n\\[${tex}\\]\n` : `\\(${tex}\\)`)
        continue
      }
      inMath = true
      mathAlt = a.alttext ?? ''
      mathBlock = a.display === 'block'
      mathAnnotation = ''
      inAnnotation = false
      continue
    }
    if (name === 'table' && (eqnDepth > 0 || hasClass(a, ['ltx_eqn_table', 'ltx_equation', 'ltx_equationgroup']))) {
      eqnDepth++
      if (eqnDepth === 1) eqnRow = []
      continue
    }
    if (eqnDepth > 0) continue
    if (name === 'br') {
      emit('\n')
      continue
    }
    if (HEADING.test(name)) {
      emit('\n\n')
      continue
    }
    if (name === 'tr') {
      cellsInRow = 0
      emit('\n')
      continue
    }
    if (name === 'td' || name === 'th') {
      if (cellsInRow++ > 0) emit(' | ')
      continue
    }
    if (BLOCK_TAGS.has(name)) emit('\n')
  }

  return tidy(out.join(''))
}

/** One space between words, no space before closing punctuation, at most one blank line in a row. */
function tidy(s: string): string {
  return s
    .replace(/[​⁡-⁤﻿]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').replace(/ ([,.;:)\]])/g, '$1').replace(/([([]) /g, '$1').trim())
    .join('\n')
    .replace(/(?:\n *){3,}/g, '\n\n')
    .trim()
}

/** The arXiv HTML address for a paper id (the latest version). */
export function arxivHtmlUrl(arxivId: string): string {
  return `https://arxiv.org/html/${arxivId}`
}
