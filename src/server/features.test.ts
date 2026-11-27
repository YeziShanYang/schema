import { describe, expect, it } from 'vitest'
import { branchProgress, cleanBranches, OTHER_BRANCH, paperProgress } from '../lib/graph/branches'
import { candidateSuggestions, paperStatus, withFinished, withoutPaper, withoutSuggestion, withPaper, withStatus } from '../lib/workspace'
import { extractCandidates, needsLoad, LOADING_STALE_MS } from './branch-resources'
import { candidatesFromResults, searchQueryFor } from './recommend'
import { excerptAround } from './explain-concept'
import { fixtureIntegration } from './pipeline/fixtures'
import type { WorkspacePaper } from '../types'

describe('cleanBranches', () => {
  it('normalizes keys and assigns every concept', () => {
    const { branches, branchOf } = cleanBranches(
      [
        { key: 'Foundations', name: 'Foundations', description: 'basics' },
        { key: 'attention', name: 'Attention', description: '' },
        { key: 'attention', name: 'Duplicate', description: '' },
        { key: 'unused', name: 'Unused', description: '' },
      ],
      [
        { id: 'c1', branchKey: 'foundations' },
        { id: 'c2', branchKey: 'attention' },
        { id: 'c3', branchKey: 'nope' },
      ],
    )
    expect(branches.map((b) => b.key)).toEqual(['foundations', 'attention', OTHER_BRANCH.key])
    expect(branchOf).toEqual({ c1: 'foundations', c2: 'attention', c3: OTHER_BRANCH.key })
  })

  it('caps the number of branches and survives garbage input', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `b${i}`, name: `B${i}` }))
    const concepts = many.map((b, i) => ({ id: `c${i}`, branchKey: b.key }))
    const { branches } = cleanBranches(many, concepts)
    expect(branches.length).toBeLessThanOrEqual(7) // 6 plus "Other" for the overflow
    expect(cleanBranches('nonsense', [{ id: 'c1', branchKey: '' }]).branches).toEqual([OTHER_BRANCH])
  })
})

describe('branch progress', () => {
  const branches = [
    { key: 'a', name: 'A', description: '' },
    { key: 'b', name: 'B', description: '' },
  ]
  const concepts = [
    { branchKey: 'a', topicKey: 't1' },
    { branchKey: 'a', topicKey: 't2' },
    { branchKey: 'b', topicKey: 't3' },
  ]
  const status = ({ topicKey: k }: { topicKey: string }) => (k === 't1' ? 'known' : k === 't3' ? 'learning' : null) as 'known' | 'learning' | null

  it('counts known and learning per branch', () => {
    expect(branchProgress(branches, concepts, status)).toEqual([
      { key: 'a', name: 'A', description: '', known: 1, learning: 0, total: 2 },
      { key: 'b', name: 'B', description: '', known: 0, learning: 1, total: 1 },
    ])
    expect(paperProgress(concepts, status)).toEqual({ known: 1, total: 3, ratio: 1 / 3 })
  })
})

describe('workspace papers', () => {
  const base: WorkspacePaper[] = [
    { paperId: 'p1', arxivId: '1', title: 'One', status: 'finished', addedAt: 1 },
    { paperId: 'p2', arxivId: '2', title: 'Two', status: 'current', addedAt: 2 },
    { paperId: 'p3', arxivId: '3', title: 'Three', status: 'previous', addedAt: 3 },
  ]
  it('adds papers as active and keeps every existing paper', () => {
    const next = withPaper(base, { paperId: 'p4', arxivId: '4', title: 'Four' }, 4)
    expect(next.map((p) => [p.paperId, p.status])).toEqual([
      ['p1', 'finished'],
      ['p2', 'active'],
      ['p3', 'active'],
      ['p4', 'active'],
    ])
  })
  it('adding a paper twice keeps one entry and its status', () => {
    const next = withPaper(base, { paperId: 'p1', arxivId: '1', title: 'One (v2)' }, 5)
    expect(next.filter((p) => p.paperId === 'p1')).toEqual([{ paperId: 'p1', arxivId: '1', title: 'One (v2)', status: 'finished', addedAt: 1 }])
  })
  it('finishes, reopens and removes papers', () => {
    expect(withFinished(base, 'p2').find((p) => p.paperId === 'p2')?.status).toBe('finished')
    expect(withStatus(base, 'p1', 'active').find((p) => p.paperId === 'p1')?.status).toBe('active')
    expect(withoutPaper(base, 'p2').map((p) => p.paperId)).toEqual(['p1', 'p3'])
    expect(paperStatus({ status: 'previous' })).toBe('active')
  })
  it('candidate suggestions exclude papers already added', () => {
    const s = [
      { arxivId: '2', title: 'Two', authors: [], reason: '' },
      { arxivId: '9', title: 'Nine', authors: [], reason: '' },
    ]
    expect(candidateSuggestions(s, base).map((x) => x.arxivId)).toEqual(['9'])
  })
  it('dismissing a suggestion removes only that entry and keeps the order', () => {
    const s = [
      { arxivId: '7', title: 'Seven', authors: ['A'], reason: 'r7' },
      { arxivId: '8', title: 'Eight', authors: [], reason: 'r8' },
      { arxivId: '9', title: 'Nine', authors: [], reason: 'r9' },
    ]
    expect(withoutSuggestion(s, '8')).toEqual([s[0], s[2]])
    expect(s).toHaveLength(3)
    expect(withoutSuggestion(s, 'missing')).toEqual(s)
    expect(withoutSuggestion(withoutSuggestion(s, '7'), '9').map((x) => x.arxivId)).toEqual(['8'])
    expect(withoutSuggestion(null, '7')).toEqual([])
  })
})

describe('lazy branch links', () => {
  const now = 1_000_000
  it('loads topics with no links or a stale loading mark', () => {
    expect(needsLoad({ resourcesStatus: 'none', resourcesLoadingAt: 0 }, now)).toBe(true)
    expect(needsLoad({ resourcesStatus: 'loading', resourcesLoadingAt: now - 1000 }, now)).toBe(false)
    expect(needsLoad({ resourcesStatus: 'loading', resourcesLoadingAt: now - LOADING_STALE_MS - 1 }, now)).toBe(true)
    expect(needsLoad({ resourcesStatus: 'ready', resourcesLoadingAt: 0 }, now)).toBe(false)
    expect(needsLoad({ resourcesStatus: 'failed', resourcesLoadingAt: 0 }, now)).toBe(false)
  })
  it('keeps at most five http results', () => {
    const results = [
      { url: 'ftp://x', title: 'bad' },
      ...Array.from({ length: 7 }, (_, i) => ({ url: `https://e.org/${i}`, title: `T${i}`, text: 'x' })),
    ]
    expect(extractCandidates({ results }).map((c) => c.url)).toEqual([0, 1, 2, 3, 4].map((i) => `https://e.org/${i}`))
  })
})

describe('recommendations', () => {
  it('extracts arXiv ids, drops non-arXiv results, duplicates and papers already in the workspace', () => {
    const results = [
      { url: 'https://arxiv.org/abs/2611.29224v1', title: 'A' },
      { url: 'https://arxiv.org/pdf/2611.29224', title: 'A again' },
      { url: 'https://example.org/post', title: 'Blog' },
      { url: 'https://arxiv.org/abs/1706.03762', title: 'Attention' },
      { url: 'https://arxiv.org/abs/2005.14165', title: 'GPT-3' },
    ]
    const c = candidatesFromResults(results, new Set(['2005.14165']))
    expect(c.map((x) => [x.n, x.arxivId])).toEqual([
      [1, '2611.29224'],
      [2, '1706.03762'],
    ])
  })

  it('asks for introductory papers when the learner knows little', () => {
    expect(searchQueryFor({ name: 'CS 229', description: '' }, [])).toMatch(/introductory/i)
    expect(searchQueryFor({ name: 'CS 229', description: '' }, Array.from({ length: 10 }, (_, i) => `t${i}`))).toMatch(/already knows t0/)
  })

  it('fixture search and ranking line up', () => {
    const search = fixtureIntegration('exa/search', { includeDomains: ['arxiv.org'] }) as { results: unknown[] }
    expect(candidatesFromResults(search.results, new Set()).map((c) => c.arxivId)).toEqual(['0000.00011', '0000.00012', '0000.00013'])
  })
})

describe('excerptAround', () => {
  const text = 'Intro. ' + 'filler '.repeat(400) + 'We add a curvature correction to each attention score. ' + 'more '.repeat(400)
  it('centers on the quote', () => {
    const ex = excerptAround(text, 'We add a curvature correction to each attention score.', '3 Method')
    expect(ex).toContain('curvature correction')
    expect(ex.length).toBeLessThan(text.length)
  })
  it('returns empty when nothing matches', () => {
    expect(excerptAround(text, 'absent sentence that is long enough', 'Nowhere section')).toBe('')
  })
})
