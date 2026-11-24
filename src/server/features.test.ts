import { describe, expect, it } from 'vitest'
import { branchProgress, cleanBranches, OTHER_BRANCH, paperProgress } from '../lib/branches'
import { withFinished, withTarget } from '../lib/workspace'
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
  const status = (k: string) => (k === 't1' ? 'known' : k === 't3' ? 'learning' : null) as 'known' | 'learning' | null

  it('counts known and learning per branch', () => {
    expect(branchProgress(branches, concepts, status)).toEqual([
      { key: 'a', name: 'A', description: '', known: 1, learning: 0, total: 2 },
      { key: 'b', name: 'B', description: '', known: 0, learning: 1, total: 1 },
    ])
    expect(paperProgress(concepts, status)).toEqual({ known: 1, total: 3, ratio: 1 / 3 })
  })
})

describe('workspace history', () => {
  const base: WorkspacePaper[] = [
    { paperId: 'p1', arxivId: '1', title: 'One', status: 'finished', addedAt: 1 },
    { paperId: 'p2', arxivId: '2', title: 'Two', status: 'current', addedAt: 2 },
  ]
  it('demotes the old target and appends the new one', () => {
    const next = withTarget(base, { paperId: 'p3', arxivId: '3', title: 'Three' }, 3)
    expect(next.map((p) => [p.paperId, p.status])).toEqual([
      ['p1', 'finished'],
      ['p2', 'previous'],
      ['p3', 'current'],
    ])
  })
  it('re-targets an existing paper without duplicating it and keeps finished papers finished', () => {
    expect(withTarget(base, { paperId: 'p2', arxivId: '2', title: 'Two' }, 3).filter((p) => p.paperId === 'p2')).toHaveLength(1)
    expect(withTarget(base, { paperId: 'p1', arxivId: '1', title: 'One' }, 3).find((p) => p.paperId === 'p1')?.status).toBe('finished')
  })
  it('marks a paper finished', () => {
    expect(withFinished(base, 'p2').find((p) => p.paperId === 'p2')?.status).toBe('finished')
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
