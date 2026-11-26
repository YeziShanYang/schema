import { describe, expect, it } from 'vitest'
import { constellationHeight, keepShown, libraryNetwork, networkShape, selectionConnections, sharedByAll, sharedWith } from './library-network'

const names = new Map([
  ['sm', 'Softmax function'],
  ['gd', 'Gradient descent'],
  ['att', 'Attention mechanism'],
  ['kl', 'KL divergence'],
])

const papers = [
  { id: 'p1', topicKeys: ['sm', 'gd', 'att', 'own1'] },
  { id: 'p2', topicKeys: ['sm', 'att', 'kl'] },
  { id: 'p3', topicKeys: ['gd', 'sm', 'own3'] },
  { id: 'p4', topicKeys: ['solo'] },
]

describe('libraryNetwork', () => {
  it('makes a shared topic of every topic two or more papers use, most papers first, then by name', () => {
    const n = libraryNetwork(papers, [], names)
    expect(n.shared.map((s) => [s.key, s.paperIds])).toEqual([
      ['sm', ['p1', 'p2', 'p3']],
      ['att', ['p1', 'p2']],
      ['gd', ['p1', 'p3']],
    ])
    expect(n.shared[0].name).toBe('Softmax function')
  })

  it("leaves each paper's other topics as its own, in the paper's order", () => {
    const n = libraryNetwork(papers, [], names)
    expect(n.papers.map((p) => [p.id, p.own.map((t) => t.key)])).toEqual([
      ['p1', ['own1']],
      ['p2', ['kl']],
      ['p3', ['own3']],
      ['p4', ['solo']],
    ])
    // A topic missing from the names is shown under its key.
    expect(n.papers[0].own[0].name).toBe('own1')
    expect(n.papers[1].own[0].name).toBe('KL divergence')
  })

  it('keeps the fields it was given on each paper', () => {
    const n = libraryNetwork([{ id: 'p1', topicKeys: ['sm'], title: 'One', known: 2 }], [], names)
    expect(n.papers[0]).toMatchObject({ id: 'p1', title: 'One', known: 2 })
  })

  it('pairs every two papers that share a topic, with the topics they share', () => {
    const n = libraryNetwork(papers, [], names)
    expect(n.pairs).toEqual([
      { a: 'p1', b: 'p2', keys: ['sm', 'att'] },
      { a: 'p1', b: 'p3', keys: ['sm', 'gd'] },
      { a: 'p2', b: 'p3', keys: ['sm'] },
    ])
    expect(sharedWith(n, 'p3')).toEqual([
      { id: 'p1', keys: ['sm', 'gd'] },
      { id: 'p2', keys: ['sm'] },
    ])
    expect(sharedWith(n, 'p4')).toEqual([])
  })

  it('checks a shared topic when any row has it, and an own topic only when its paper does', () => {
    const checks = [
      { paperId: 'elsewhere', topicKey: 'gd' },
      { paperId: 'p2', topicKey: 'own1' },
      { paperId: 'p2', topicKey: 'kl' },
    ]
    const n = libraryNetwork(papers, checks, names)
    expect(n.shared.filter((s) => s.checked).map((s) => s.key)).toEqual(['gd'])
    expect(n.papers[0].own).toEqual([{ key: 'own1', name: 'own1', checked: false }])
    expect(n.papers[1].own).toEqual([{ key: 'kl', name: 'KL divergence', checked: true }])
  })

  it('ignores stale rows and rows that are not known', () => {
    const checks = [
      { paperId: 'p1', topicKey: 'own1', stale: true },
      { paperId: 'p1', topicKey: 'sm', status: 'learning' },
      { paperId: 'p3', topicKey: 'own3', status: 'known' },
    ]
    const n = libraryNetwork(papers, checks, names)
    expect(n.shared.some((s) => s.checked)).toBe(false)
    expect(n.papers[0].own[0].checked).toBe(false)
    expect(n.papers[2].own[0].checked).toBe(true)
  })

  it('counts a paper once and a repeated topic once, and handles papers with no topics', () => {
    const n = libraryNetwork(
      [
        { id: 'p1', topicKeys: ['sm', 'sm', ''] },
        { id: 'p1', topicKeys: ['gd'] },
        { id: 'p2', topicKeys: null },
        { id: 'p3' },
      ],
      [],
      names,
    )
    expect(n.papers.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(n.papers[0].own.map((t) => t.key)).toEqual(['sm'])
    expect(n.shared).toEqual([])
    expect(n.pairs).toEqual([])
  })

  it('is empty for no papers', () => {
    expect(libraryNetwork([], [], names)).toEqual({ papers: [], shared: [], pairs: [] })
  })
})

describe('selectionConnections', () => {
  const n = libraryNetwork(papers, [{ paperId: 'x', topicKey: 'gd' }], names)
  const keys = (sel: string[]) => selectionConnections(n, sel).map((c) => c.key)

  it('is empty with nothing selected', () => {
    expect(selectionConnections(n, [])).toEqual([])
    expect(selectionConnections(n, ['gone'])).toEqual([])
  })

  it('gives one selected paper every shared topic it uses, with the papers it shares each with', () => {
    expect(selectionConnections(n, ['p3'])).toEqual([
      { key: 'sm', name: 'Softmax function', checked: false, selected: ['p3'], others: ['p1', 'p2'], all: false },
      { key: 'gd', name: 'Gradient descent', checked: true, selected: ['p3'], others: ['p1'], all: false },
    ])
    expect(keys(['p4'])).toEqual([])
  })

  it('keeps, for two or more, the topics at least two of them use, all-shared first', () => {
    expect(keys(['p1', 'p2'])).toEqual(['sm', 'att'])
    expect(keys(['p2', 'p3'])).toEqual(['sm'])
    const three = selectionConnections(n, ['p1', 'p2', 'p3'])
    expect(three.map((c) => [c.key, c.selected, c.all])).toEqual([
      ['sm', ['p1', 'p2', 'p3'], true],
      ['att', ['p1', 'p2'], false],
      ['gd', ['p1', 'p3'], false],
    ])
    expect(three[1].others).toEqual([])
  })

  it('finds no connection between papers that share nothing', () => {
    expect(keys(['p2', 'p4'])).toEqual([])
    expect(keys(['p1', 'gone'])).toEqual(['sm', 'att', 'gd'])
  })

  it('names the topics every selected paper uses', () => {
    expect(sharedByAll(n, ['p1', 'p2'])).toEqual(['sm', 'att'])
    expect(sharedByAll(n, ['p1', 'p2', 'p3'])).toEqual(['sm'])
    expect(sharedByAll(n, ['p1', 'p2', 'p3', 'p4'])).toEqual([])
    expect(sharedByAll(n, ['p1'])).toEqual([])
  })
})

describe('keepShown', () => {
  it('drops selected papers that are no longer shown, keeping the order', () => {
    const n = libraryNetwork(papers.slice(0, 2), [], names)
    expect(keepShown(['p2', 'p3', 'p1'], n)).toEqual(['p2', 'p1'])
  })
})

describe('networkShape', () => {
  it('ignores order, names and checkmarks', () => {
    const a = networkShape(libraryNetwork(papers, [], names))
    const b = networkShape(libraryNetwork([...papers].reverse(), [{ paperId: 'p1', topicKey: 'sm' }], new Map()))
    expect(b).toBe(a)
  })

  it('changes when a paper or a shared topic does', () => {
    const a = networkShape(libraryNetwork(papers, [], names))
    expect(networkShape(libraryNetwork(papers.slice(0, 3), [], names))).not.toBe(a)
    expect(networkShape(libraryNetwork([...papers.slice(0, 3), { id: 'p4', topicKeys: ['kl'] }], [], names))).not.toBe(a)
  })
})

describe('constellationHeight', () => {
  it('grows 40px a paper between 560px and 900px', () => {
    expect(constellationHeight(0)).toBe(560)
    expect(constellationHeight(6)).toBe(560)
    expect(constellationHeight(7)).toBe(580)
    expect(constellationHeight(15)).toBe(900)
    expect(constellationHeight(40)).toBe(900)
  })
})
