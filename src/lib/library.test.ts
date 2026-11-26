import { describe, expect, it } from 'vitest'
import { emptyText, filterRows, groupByWorkspace, libraryQuery, matchTopics, NO_WORKSPACE, parseLibraryQuery, topicCounts } from './library'
import type { RoadmapStatus } from '../types'

const row = (paperId: string, status: RoadmapStatus = 'reading') => ({ recordId: `r-${paperId}`, data: { paperId, status } })
const ids = (rows: { data: { paperId: string } }[]) => rows.map((r) => r.data.paperId)

describe('parseLibraryQuery', () => {
  it('defaults to last opened and every topic', () => {
    expect(parseLibraryQuery('')).toEqual({ sort: 'opened', topic: null })
    expect(parseLibraryQuery('?sort=title&topic=')).toEqual({ sort: 'opened', topic: null })
  })

  it('reads the workspace sort and a topic key', () => {
    expect(parseLibraryQuery('?sort=workspace&topic=softmax-function')).toEqual({ sort: 'workspace', topic: 'softmax-function' })
    expect(parseLibraryQuery(new URLSearchParams('topic=gradient-descent'))).toEqual({ sort: 'opened', topic: 'gradient-descent' })
  })
})

describe('libraryQuery', () => {
  it('writes sort before topic and drops the defaults', () => {
    expect(libraryQuery('', { topic: 'softmax-function', sort: 'workspace' }).toString()).toBe('sort=workspace&topic=softmax-function')
    expect(libraryQuery('?sort=workspace&topic=a', { sort: 'opened' }).toString()).toBe('topic=a')
    expect(libraryQuery('?sort=workspace&topic=a', { topic: null }).toString()).toBe('sort=workspace')
  })

  it('keeps other parameters after its own', () => {
    expect(libraryQuery('?signin=1&topic=a', { sort: 'workspace' }).toString()).toBe('sort=workspace&topic=a&signin=1')
  })

  it('round-trips through parseLibraryQuery', () => {
    const q = { sort: 'workspace', topic: 'scaled-dot-product-scores' } as const
    expect(parseLibraryQuery(libraryQuery('', q))).toEqual(q)
  })
})

describe('topicCounts', () => {
  const names = new Map([
    ['a', 'Attention mechanism'],
    ['s', 'Softmax function'],
    ['g', 'Gradient descent'],
  ])

  it('counts papers per topic, most used first, then by name', () => {
    const papers = [{ topicKeys: ['s', 'g'] }, { topicKeys: ['s', 'a'] }, { topicKeys: ['g', 's'] }]
    expect(topicCounts(papers, names)).toEqual([
      { key: 's', name: 'Softmax function', count: 3 },
      { key: 'g', name: 'Gradient descent', count: 2 },
      { key: 'a', name: 'Attention mechanism', count: 1 },
    ])
  })

  it('breaks count ties by name, not by key', () => {
    const papers = [{ topicKeys: ['s'] }, { topicKeys: ['a'] }, { topicKeys: ['g'] }]
    expect(topicCounts(papers, names).map((t) => t.name)).toEqual(['Attention mechanism', 'Gradient descent', 'Softmax function'])
  })

  it('counts a paper once per topic and skips papers without topics', () => {
    expect(topicCounts([{ topicKeys: ['s', 's'] }, { topicKeys: [] }, {}, { topicKeys: null }], names)).toEqual([{ key: 's', name: 'Softmax function', count: 1 }])
  })

  it('lists a topic with no name under its key', () => {
    expect(topicCounts([{ topicKeys: ['unknown-topic'] }], names)).toEqual([{ key: 'unknown-topic', name: 'unknown-topic', count: 1 }])
  })
})

describe('matchTopics', () => {
  const topics = [
    { key: 's', name: 'Softmax function', count: 3 },
    { key: 'd', name: 'Scaled dot-product scores', count: 1 },
  ]

  it('matches every word of the query in the name, ignoring case', () => {
    expect(matchTopics(topics, 'SOFT')).toEqual([topics[0]])
    expect(matchTopics(topics, 'scores scaled')).toEqual([topics[1]])
    expect(matchTopics(topics, 'softmax scores')).toEqual([])
  })

  it('returns every topic for a blank query', () => {
    expect(matchTopics(topics, '  ')).toEqual(topics)
  })
})

describe('filterRows', () => {
  const rows = [row('p1'), row('p2', 'finished'), row('p3'), row('p4', 'finished')]
  const topics: Record<string, string[]> = { p1: ['s', 'g'], p2: ['s'], p3: ['g'] }
  const of = (id: string) => topics[id]

  it('filters by status and keeps the order', () => {
    expect(ids(filterRows(rows, { status: 'all', topic: null }, of))).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(ids(filterRows(rows, { status: 'finished', topic: null }, of))).toEqual(['p2', 'p4'])
  })

  it('keeps only papers that use the topic, combined with the status', () => {
    expect(ids(filterRows(rows, { status: 'all', topic: 's' }, of))).toEqual(['p1', 'p2'])
    expect(ids(filterRows(rows, { status: 'reading', topic: 's' }, of))).toEqual(['p1'])
    expect(ids(filterRows(rows, { status: 'finished', topic: 'g' }, of))).toEqual([])
  })

  it('drops a paper whose topics are unknown when a topic is set', () => {
    expect(ids(filterRows(rows, { status: 'all', topic: 'g' }, of))).toEqual(['p1', 'p3'])
  })
})

describe('groupByWorkspace', () => {
  // Most recently opened first, as the page passes them.
  const rows = [row('p1'), row('p2'), row('p3'), row('p4')]

  it('groups rows under workspaces in the given order, with loose papers last', () => {
    const groups = groupByWorkspace(rows, [
      { id: 'w2', name: 'CS 229', paperIds: ['p3', 'p1'] },
      { id: 'w1', name: 'Climate', paperIds: ['p2'] },
    ])
    expect(groups.map((g) => [g.workspaceId, g.name, ids(g.rows)])).toEqual([
      ['w2', 'CS 229', ['p1', 'p3']],
      ['w1', 'Climate', ['p2']],
      [null, NO_WORKSPACE, ['p4']],
    ])
  })

  it('lists a paper in two workspaces under both', () => {
    const groups = groupByWorkspace(rows, [
      { id: 'w1', name: 'A', paperIds: ['p1', 'p2'] },
      { id: 'w2', name: 'B', paperIds: ['p2'] },
    ])
    expect(groups.map((g) => ids(g.rows))).toEqual([['p1', 'p2'], ['p2'], ['p3', 'p4']])
  })

  it('leaves out workspaces with no rows and the loose group when every paper is filed', () => {
    const groups = groupByWorkspace([row('p1')], [
      { id: 'w1', name: 'Empty', paperIds: [] },
      { id: 'w2', name: 'Other papers', paperIds: ['p9'] },
      { id: 'w3', name: 'Has it', paperIds: ['p1'] },
    ])
    expect(groups.map((g) => g.workspaceId)).toEqual(['w3'])
  })

  it('keeps a filtered-out paper out of the loose group when it is in a workspace', () => {
    // p2 passed no filter, so it is absent from rows; p1 is in a workspace whose other papers were filtered out.
    const groups = groupByWorkspace([row('p1'), row('p3')], [{ id: 'w1', name: 'A', paperIds: ['p1', 'p2'] }])
    expect(groups.map((g) => [g.workspaceId, ids(g.rows)])).toEqual([
      ['w1', ['p1']],
      [null, ['p3']],
    ])
  })

  it('returns no groups for no rows', () => {
    expect(groupByWorkspace([], [{ id: 'w1', name: 'A', paperIds: ['p1'] }])).toEqual([])
  })
})

describe('emptyText', () => {
  it('keeps the status texts when no topic is set', () => {
    expect(emptyText('finished', null)).toBe('No finished papers yet. Papers you mark finished are listed here.')
    expect(emptyText('all', null)).toBe('No papers here yet. Papers you open are saved here automatically.')
  })

  it('names the status filter and the topic', () => {
    expect(emptyText('all', 'Softmax function')).toBe('No papers use the topic Softmax function.')
    expect(emptyText('reading', 'Softmax function')).toBe('No papers in progress use the topic Softmax function.')
    expect(emptyText('finished', 'Gradient descent')).toBe('No finished papers use the topic Gradient descent.')
  })
})
