import { describe, expect, it } from 'vitest'
import { parseArxivAtom } from './arxiv-meta'
import { findMessage } from './llm'
import { fixtureIntegration, FIXTURE_PAPER_TEXT } from './fixtures'
import { resourcesUser } from './prompts'
import { preparePaperText } from '../../lib/paper-text'
import { isQuoteVerified, normalizeForMatch } from '../../lib/quotes'

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

describe('fixtures', () => {
  it('fixture quotes verify against the fixture text, except the deliberate fake', () => {
    const json = JSON.parse(
      (fixtureIntegration('anthropic/chat-completion', {}, 'concepts') as { content: { text: string }[] }).content[0].text,
    )
    const norm = normalizeForMatch(preparePaperText(FIXTURE_PAPER_TEXT).text)
    const verified = json.concepts.map((c: { quote: string }) => isQuoteVerified(c.quote, norm))
    expect(verified).toEqual([true, true, true, false])
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
