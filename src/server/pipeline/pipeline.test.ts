import { describe, expect, it } from 'vitest'
import { parseArxivAtom } from './arxiv-meta'
import { findMessage } from './llm'
import { fixtureHtml, fixtureIntegration, FIXTURE_PAPER_HTML, FIXTURE_PAPER_TEXT } from './fixtures'
import { conceptCountRange, conceptsSystem, explainSystem, resourcesUser, sourceNote } from './prompts'
import { parseConcepts } from './run'
import { preparePaperText } from '../../lib/paper-text'
import { arxivHtmlToText } from '../../lib/paper-html'
import { indexPaperText, normalizeForMatch } from '../../lib/quotes'
import { pickQuote, quotePickOrder } from '../../lib/quote-rules'
import { findNamedQuote, nameTerms, quoteSearch } from '../../lib/quote-fallback'

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
    const index = indexPaperText(preparePaperText(arxivHtmlToText(FIXTURE_PAPER_HTML), undefined, 'html').text)
    const used = new Set<string>()
    const picks = Object.fromEntries(quotePickOrder(fixtureConcepts()).map((c) => [c.id, pickQuote(c.quotes, index, used)]))
    expect(Object.entries(picks).filter(([, p]) => !p.quote).map(([id]) => id).sort()).toEqual(['c4', 'c5'])
    expect(picks.c5.rejected.map((r) => r.problem)).toEqual(['duplicate'])
    expect(picks.c6.rejected.map((r) => r.problem)).toEqual(['display-math'])
    expect(picks.c6.quote).toContain('\\(\\sqrt{d_{k}}\\)')
    expect(picks.c7.rejected.map((r) => r.problem)).toEqual(['duplicate'])
    expect(picks.c8.rejected.map((r) => r.problem)).toEqual(['short'])
    // c5 then finds its quote by name; c4's name is in no sentence.
    const search = quoteSearch(index)
    expect(findNamedQuote(nameTerms('Gradient descent', 'Gradient descent'), search, used)?.quote).toBe(
      'We assume the reader knows how gradient descent updates parameters by following the negative gradient of a loss.',
    )
    expect(findNamedQuote(nameTerms('Invented concept with a made-up quote', 'Invented concept with a made-up quote'), search, used)).toBeNull()
  })

  it('takes the PDF path for ids ending in 77, 99 or 66, and the PDF text keeps its quotes', () => {
    expect(fixtureHtml('https://arxiv.org/html/0000.00001').status).toBe(200)
    for (const id of ['0000.00177', '0000.00199', '0000.00166']) expect(fixtureHtml(`https://arxiv.org/html/${id}`).status).toBe(404)
    const norm = normalizeForMatch(preparePaperText(FIXTURE_PAPER_TEXT).text)
    const used = new Set<string>()
    expect(quotePickOrder(fixtureConcepts()).filter((c) => !pickQuote(c.quotes, norm, used).quote).map((c) => c.id).sort()).toEqual(['c4', 'c5'])
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

describe('walkthrough prompt', () => {
  it('asks for every formula in a summary as LaTeX, in the rule and in the JSON shape', () => {
    for (const source of ['html', 'pdf'] as const) {
      const p = explainSystem(source)
      expect(p).toContain('Write every formula, variable and symbol in a summary as LaTeX between \\( and \\) (inline) or \\[ and \\] (display), never as plain text')
      expect(p).toContain('not sqrt(d_k)')
      expect(p).toContain('"summary": "3 to 5 sentences. Math as LaTeX in \\\\( \\\\) or \\\\[ \\\\]."')
    }
  })

  it('asks for one entry per top-level section through the conclusion, with headings as the paper writes them', () => {
    const p = explainSystem('html')
    expect(p).toContain('one entry for each top-level section, from the first section through the conclusion')
    expect(p).toContain("Fold a section's subsections into its entry")
    expect(p).toContain('never add a number the paper does not use, such as "2.x"')
    expect(p).not.toMatch(/4 to 10 entries/)
  })
})

describe('indexPaperText', () => {
  it('normalizes exactly like normalizeForMatch on both fixture texts', async () => {
    const { indexPaperText } = await import('../../lib/quotes')
    for (const raw of [arxivHtmlToText(FIXTURE_PAPER_HTML), FIXTURE_PAPER_TEXT, 'ﬁnal exam-\nple, café Ünïcode']) {
      expect(indexPaperText(raw).norm).toBe(normalizeForMatch(raw))
    }
  })
})
