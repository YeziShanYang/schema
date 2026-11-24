import { describe, expect, it } from 'vitest'
import { arxivFromSlug, arxivSlug, parseArxivId } from './arxiv'
import { cutAtReferences, preparePaperText } from './paper-text'
import { isQuoteVerified, normalizeForMatch, quoteScore } from './quotes'
import { cleanGraph } from './graph'
import { extractJsonObject } from './json'
import { normalizeTopicKey, STARTER_TOPICS } from './topics'
import { capState, CAP_WINDOW_MS } from './cap'

describe('parseArxivId', () => {
  it.each([
    ['2611.29002', '2611.29002', ''],
    ['2611.29002v1', '2611.29002', 'v1'],
    ['1706.03762', '1706.03762', ''],
    ['arXiv:1706.03762v7', '1706.03762', 'v7'],
    ['https://arxiv.org/abs/2611.29224', '2611.29224', ''],
    ['https://arxiv.org/pdf/2611.29224v1', '2611.29224', 'v1'],
    ['arxiv.org/pdf/1706.03762.pdf', '1706.03762', ''],
    ['https://arxiv.org/html/2611.29002v1#S3', '2611.29002', 'v1'],
    ['https://export.arxiv.org/abs/2611.29002?context=cs', '2611.29002', ''],
    ['hep-th/9901001', 'hep-th/9901001', ''],
    ['math.AG/0601001v2', 'math.AG/0601001', 'v2'],
    ['https://arxiv.org/abs/hep-th/9901001', 'hep-th/9901001', ''],
    ['  2611.29002  ', '2611.29002', ''],
  ])('parses %s', (input, id, version) => {
    expect(parseArxivId(input)).toEqual({ id, version })
  })

  it.each(['', 'hello', '2611.290', '261.29002', 'https://example.com/abs/2611.29002', '2611.29002/../x', 'hep-th/99010'])(
    'rejects %s',
    (input) => {
      expect(parseArxivId(input)).toBeNull()
    },
  )

  it('round-trips slugs for old-style ids', () => {
    expect(arxivSlug('math.AG/0601001')).toBe('math.AG_0601001')
    expect(arxivFromSlug(arxivSlug('math.AG/0601001'))).toBe('math.AG/0601001')
    expect(arxivFromSlug(arxivSlug('2611.29002'))).toBe('2611.29002')
  })
})

describe('preparePaperText', () => {
  const body = 'Introduction\n' + 'Some text about models. '.repeat(200)
  it('cuts at a References heading after the first 15% of the text', () => {
    const raw = `${body}\nReferences\n[1] A. Author. A paper.\nAppendix A\nMore.`
    const { text, cut } = cutAtReferences(raw)
    expect(cut).toBe(true)
    expect(text.endsWith('models.')).toBe(true)
    expect(text).not.toContain('[1] A. Author')
  })

  it('ignores a References line inside an early table of contents', () => {
    const raw = `Contents\nReferences\n${body}`
    expect(cutAtReferences(raw).cut).toBe(false)
  })

  it('accepts numbered and uppercase headings', () => {
    expect(cutAtReferences(`${body}\n7 REFERENCES\n[1] x`).cut).toBe(true)
    expect(cutAtReferences(`${body}\nBibliography\n[1] x`).cut).toBe(true)
  })

  it('caps very long text', () => {
    const r = preparePaperText('x'.repeat(1000), 100)
    expect(r.text.length).toBe(100)
    expect(r.truncated).toBe(true)
  })
})

describe('quote verification', () => {
  const paper = normalizeForMatch(
    'The label Ĥ is a least-squares quadratic on n noisy labels. We fit linear probes to galaxy em-\nbeddings from five pretrained encoders and intervene on this ﬁnal curvature term.',
  )

  it('matches exact quotes despite case, punctuation and line-break hyphens', () => {
    expect(quoteScore('We fit linear probes to galaxy embeddings from five pretrained encoders', paper)).toBe(1)
  })

  it('folds accents and ligatures', () => {
    expect(quoteScore('The label Ĥ is a least-squares quadratic on n noisy labels.', paper)).toBe(1)
    expect(quoteScore('intervene on this final curvature term', paper)).toBe(1)
  })

  it('scores invented quotes low', () => {
    expect(isQuoteVerified('Transformers revolutionized computer vision through massive pretraining runs', paper)).toBe(false)
  })

  it('gives partial credit when most of a quote survives extraction noise', () => {
    const s = quoteScore('We fit linear probes to galaxy embeddings from five pretrained encoders ∥x∥', paper)
    expect(s).toBeGreaterThan(0.6)
  })
})

describe('cleanGraph', () => {
  it('drops dangling and self dependencies and computes tiers', () => {
    const g = cleanGraph([
      { id: 'c1', dependsOn: [] },
      { id: 'c2', dependsOn: ['c1', 'c9', 'c2'] },
      { id: 'c3', dependsOn: ['c2', 'c1'] },
    ])
    expect(g.deps).toEqual({ c1: [], c2: ['c1'], c3: ['c2', 'c1'] })
    expect(g.tiers).toEqual({ c1: 0, c2: 1, c3: 2 })
    expect(g.danglingRemoved).toBe(2)
  })

  it('breaks cycles', () => {
    const g = cleanGraph([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['c'] },
      { id: 'c', dependsOn: ['a'] },
    ])
    expect(g.removedEdges.length).toBe(1)
    // Still a DAG: every tier is finite and consistent.
    for (const id of g.ids) {
      for (const d of g.deps[id]) expect(g.tiers[id]).toBeGreaterThan(g.tiers[d])
    }
  })

  it('removes duplicate ids', () => {
    const g = cleanGraph([
      { id: 'a', dependsOn: [] },
      { id: 'a', dependsOn: [] },
      { id: '', dependsOn: [] },
    ])
    expect(g.ids).toEqual(['a'])
  })
})

describe('extractJsonObject', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('Here you go: {"a": {"b": 2}} thanks')).toEqual({ a: { b: 2 } })
  })
  it('returns null for arrays and garbage', () => {
    expect(extractJsonObject('[1,2]')).toBeNull()
    expect(extractJsonObject('not json')).toBeNull()
    expect(extractJsonObject('{"a": ')).toBeNull()
  })
})

describe('normalizeTopicKey', () => {
  it('slugifies names', () => {
    expect(normalizeTopicKey('Softmax Function')).toBe('softmax-function')
    expect(normalizeTopicKey('  Bayes’ theorem ')).toBe('bayes-theorem')
    expect(normalizeTopicKey('Q&A models')).toBe('q-and-a-models')
    expect(normalizeTopicKey('Évaluation (metrics)')).toBe('evaluation-metrics')
    expect(normalizeTopicKey('a'.repeat(80)).length).toBeLessThanOrEqual(60)
  })
  it('gives every starter topic a unique key', () => {
    const keys = STARTER_TOPICS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => k.length > 0)).toBe(true)
  })
})

describe('capState', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  it('counts only requests inside the rolling window', () => {
    const s = capState(['2026-11-24T11:00:00Z', '2026-11-23T11:59:00Z', now - 1000], now, 5)
    expect(s.used).toBe(2)
    expect(s.allowed).toBe(true)
    expect(s.remaining).toBe(3)
  })
  it('blocks at the cap and reports when a slot frees up', () => {
    const times = [1, 2, 3, 4, 5].map((h) => now - h * 60 * 60 * 1000)
    const s = capState(times, now, 5)
    expect(s.allowed).toBe(false)
    expect(s.nextSlotAt).toBe(now - 5 * 60 * 60 * 1000 + CAP_WINDOW_MS)
  })
  it('accepts unix seconds', () => {
    expect(capState([Math.floor((now - 1000) / 1000)], now, 5).used).toBe(1)
  })
})
