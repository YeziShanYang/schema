import { describe, expect, it } from 'vitest'
import { parseArxivAtom } from './arxiv-meta'
import { findMessage } from './llm'
import { fixtureHtml, fixtureIntegration, FIXTURE_PAPER_HTML, FIXTURE_PAPER_TEXT } from './fixtures'
import { conceptCountRange, conceptsSystem, resourcesUser, sourceNote } from './prompts'
import { parseConcepts } from './run'
import { preparePaperText } from '../../lib/paper-text'
import { arxivHtmlToText } from '../../lib/paper-html'
import { normalizeForMatch } from '../../lib/quotes'
import { pickQuote } from '../../lib/quote-rules'

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.29224v1</id>
    <published>2026-11-22T10:00:00Z</published>
    <title>Curvature Mismatch and Local Errors
      in Galaxy Property Estimation</title>
    <summary>Linear probes are widely used &amp; studied.</summary>
    <author><name>Austin Lutterbach</name></author>
    <author><name>Michael J. Smith</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`

describe('parseArxivAtom', () => {
  it('reads title, authors, abstract, category and version', () => {
    const m = parseArxivAtom(ATOM, '2611.29224')
    expect(m).toMatchObject({
      id: '2611.29224',
      version: 'v1',
      title: 'Curvature Mismatch and Local Errors in Galaxy Property Estimation',
      authors: ['Austin Lutterbach', 'Michael J. Smith'],
      abstract: 'Linear probes are widely used & studied.',
      primaryCategory: 'cs.LG',
    })
  })

  it('returns null for an empty feed or an error entry', () => {
    expect(parseArxivAtom('<feed></feed>', '2611.99999')).toBeNull()
    const err = `<feed><entry><id>http://arxiv.org/api/errors#incorrect_id</id><title>Error</title></entry></feed>`
    expect(parseArxivAtom(err, '2611.99999')).toBeNull()
  })

  it('rejects an entry for a different paper', () => {
    expect(parseArxivAtom(ATOM, '1706.03762')).toBeNull()
  })
})

describe('findMessage', () => {
  it('finds the message directly or inside a wrapper', () => {
    const msg = { content: [{ type: 'text', text: 'hi' }] }
    expect(findMessage(msg)).toBe(msg)
    expect(findMessage({ response: msg })).toBe(msg)
    expect(findMessage({ data: { response: msg } })).toBe(msg)
    expect(findMessage({ nothing: true })).toBeNull()
  })
})

function fixtureConcepts() {
  return parseConcepts(JSON.parse((fixtureIntegration('anthropic/chat-completion', {}, 'concepts') as { content: { text: string }[] }).content[0].text))
}

describe('fixtures', () => {
  it('fixture quotes pass the quote rules against the HTML text as the header describes', () => {
    const norm = normalizeForMatch(preparePaperText(arxivHtmlToText(FIXTURE_PAPER_HTML), undefined, 'html').text)
    const used = new Set<string>()
    const picks = Object.fromEntries(fixtureConcepts().map((c) => [c.id, pickQuote(c.quotes, norm, used)]))
    expect(Object.entries(picks).filter(([, p]) => !p.quote).map(([id]) => id)).toEqual(['c4'])
    expect(picks.c6.rejected.map((r) => r.problem)).toEqual(['display-math'])
    expect(picks.c6.quote).toContain('\\(\\sqrt{d_{k}}\\)')
    expect(picks.c7.rejected.map((r) => r.problem)).toEqual(['duplicate'])
    expect(picks.c8.rejected.map((r) => r.problem)).toEqual(['short'])
  })

  it('takes the PDF path for ids ending in 77, 99 or 66, and the PDF text keeps its quotes', () => {
    expect(fixtureHtml('https://arxiv.org/html/0000.00001').status).toBe(200)
    for (const id of ['0000.00177', '0000.00199', '0000.00166']) expect(fixtureHtml(`https://arxiv.org/html/${id}`).status).toBe(404)
    const norm = normalizeForMatch(preparePaperText(FIXTURE_PAPER_TEXT).text)
    const used = new Set<string>()
    expect(fixtureConcepts().filter((c) => !pickQuote(c.quotes, norm, used).quote).map((c) => c.id)).toEqual(['c4'])
  })

  it('reads the older single-quote format', () => {
    expect(parseConcepts({ concepts: [{ id: 'c1', name: 'A', quote: 'One quote.' }] })[0].quotes).toEqual(['One quote.'])
  })

  it('fixture resource picks follow the prompt format', () => {
    const user = resourcesUser([
      { key: 'softmax-function', name: 'Softmax', description: 'x', candidates: [{ title: 'T', url: 'https://a.org/1', snippet: 's' }] },
    ])
    const res = fixtureIntegration('anthropic/chat-completion', { messages: [{ content: user }] }, 'resources') as {
      content: { text: string }[]
    }
    expect(JSON.parse(res.content[0].text)).toEqual({
      topics: [{ key: 'softmax-function', resources: [{ url: 'https://a.org/1', why: 'Covers the basics step by step.' }] }],
    })
  })
})

describe('concepts prompt', () => {
  it('scales the concept count with length and warns about PDF math', () => {
    expect(conceptCountRange(39_999)).toBe('10 to 18')
    expect(conceptCountRange(40_000)).toBe('12 to 24')
    expect(conceptsSystem('pdf', 50_000)).toContain('12 to 24')
    expect(sourceNote('pdf')).toMatch(/never state one as fact/)
    expect(sourceNote('html')).toMatch(/LaTeX/)
  })
})
