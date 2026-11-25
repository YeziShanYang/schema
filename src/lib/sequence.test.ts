import { describe, expect, it } from 'vitest'
import { branchOrder, recommendedSequence, type SeqConcept } from './sequence'
import type { KnowledgeStatus } from '../types'

const branches = [
  { key: 'attn', name: 'Attention' },
  { key: 'math', name: 'Math tools' },
  { key: 'arch', name: 'Architecture' },
]

const c = (key: string, branchKey: string, tier: number, order: number, dependsOn: string[] = []): SeqConcept => ({
  key,
  name: key.toUpperCase(),
  tier,
  order,
  branchKey,
  topicKey: `t-${key}`,
  dependsOn,
})

const concepts = [
  c('softmax', 'math', 0, 0),
  c('dot', 'math', 0, 1),
  c('attention', 'attn', 1, 2, ['softmax', 'dot']),
  c('scaled', 'attn', 2, 3, ['attention']),
  c('posenc', 'arch', 1, 4),
  c('multihead', 'arch', 3, 5, ['scaled']),
]

const statuses = (m: Record<string, KnowledgeStatus>) => (concept: SeqConcept) => m[concept.topicKey] ?? null

describe('recommendedSequence', () => {
  it('moves a branch after the branches it depends on', () => {
    const s = recommendedSequence(branches, concepts, statuses({}))
    // attention depends on math concepts, and multihead (arch) on scaled (attn)
    expect(s.steps.map((x) => x.branchKey)).toEqual(['math', 'attn', 'arch'])
    expect(s.steps.map((x) => x.index)).toEqual([1, 2, 3])
  })

  it('keeps the model order for independent branches', () => {
    const tie = [c('a', 'arch', 1, 0), c('b', 'attn', 1, 1)]
    expect(recommendedSequence(branches, tie, statuses({})).steps.map((x) => x.branchKey).slice(0, 2)).toEqual(['attn', 'arch'])
  })

  it('does not pull a late, prerequisite-free branch to the front', () => {
    // Training concepts have no prerequisites (tier 0), but the model lists the branch last.
    const order = [{ key: 'seq', name: 'Sequence models' }, { key: 'attn', name: 'Attention' }, { key: 'train', name: 'Training' }]
    const list = [c('rnn', 'seq', 0, 0), c('qkv', 'attn', 1, 1, ['rnn']), c('dropout', 'train', 0, 2), c('bleu', 'train', 0, 3)]
    const s = recommendedSequence(order, list, statuses({}))
    expect(s.steps.map((x) => x.branchKey)).toEqual(['seq', 'attn', 'train'])
    expect(s.nextUp?.key).toBe('rnn')
  })

  it('falls back to the model order when branches depend on each other', () => {
    const cyc = [c('a', 'attn', 0, 0, ['b']), c('b', 'math', 0, 1, ['a'])]
    expect(recommendedSequence(branches, cyc, statuses({})).steps.map((x) => x.branchKey).slice(0, 2)).toEqual(['attn', 'math'])
  })

  it('orders concepts branch by branch, then by tier and model order', () => {
    const s = recommendedSequence(branches, concepts, statuses({}))
    expect(s.concepts.map((x) => x.key)).toEqual(['softmax', 'dot', 'attention', 'scaled', 'posenc', 'multihead'])
  })

  it('starts with the first concept when nothing is known', () => {
    const s = recommendedSequence(branches, concepts, statuses({}))
    expect(s.nextUp?.key).toBe('softmax')
    expect(s.fresh).toBe(true)
    expect(s.steps[0].state).toBe('current')
  })

  it('skips concepts whose prerequisites are not known or learning', () => {
    const s = recommendedSequence(branches, concepts, statuses({ 't-softmax': 'known', 't-dot': 'learning' }))
    expect(s.nextUp?.key).toBe('dot') // dot is not known yet and has no prerequisites
    const s2 = recommendedSequence(branches, concepts, statuses({ 't-softmax': 'known', 't-dot': 'known' }))
    expect(s2.nextUp?.key).toBe('attention')
    expect(s2.steps.find((x) => x.branchKey === 'math')?.state).toBe('done')
    expect(s2.steps.find((x) => x.branchKey === 'attn')?.state).toBe('current')
    expect(s2.fresh).toBe(false)
  })

  it('counts only known as satisfying a prerequisite', () => {
    const chain = [c('x', 'math', 0, 0), c('y', 'attn', 1, 1, ['x'])]
    // "learning" rows from earlier versions do not unblock y; x stays next up.
    expect(recommendedSequence(branches, chain, statuses({ 't-x': 'learning' })).nextUp?.key).toBe('x')
    expect(recommendedSequence(branches, chain, statuses({ 't-x': 'known' })).nextUp?.key).toBe('y')
  })

  it('jumps past a blocked concept to the first ready one', () => {
    const s = recommendedSequence(branches, [c('x', 'math', 0, 0), c('y', 'attn', 1, 1, ['x']), c('z', 'arch', 1, 2)], statuses({ 't-x': 'known' }))
    expect(s.nextUp?.key).toBe('y')
    const blocked = recommendedSequence(branches, [c('y', 'attn', 1, 1, ['x']), c('x', 'math', 2, 0), c('z', 'arch', 1, 2)], statuses({}))
    expect(blocked.nextUp?.key).toBe('x') // math moves ahead of attn because y needs x
  })

  it('falls back to the first unknown concept when none is ready', () => {
    const cyclic = [c('p', 'math', 0, 0, ['q']), c('q', 'math', 0, 1, ['p'])]
    expect(recommendedSequence(branches, cyclic, statuses({})).nextUp?.key).toBe('p')
  })

  it('reports all known and numbers concepts within each branch', () => {
    const all = Object.fromEntries(concepts.map((x) => [x.topicKey, 'known' as const]))
    const s = recommendedSequence(branches, concepts, statuses(all))
    expect(s.allKnown).toBe(true)
    expect(s.nextUp).toBeNull()
    expect(s.steps.every((x) => x.state === 'done')).toBe(true)
    expect(s.stepInBranch.get('attention')).toBe(1)
    expect(s.stepInBranch.get('scaled')).toBe(2)
  })

  it('puts branches with no concepts last', () => {
    const s = recommendedSequence([...branches, { key: 'empty', name: 'Empty' }], concepts, statuses({}))
    expect(s.steps[s.steps.length - 1].branchKey).toBe('empty')
  })
})

describe('branchOrder', () => {
  it('reports when the branches depend on each other in a circle and the model order decides', () => {
    const two = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }]
    const cyclic = [c('a1', 'a', 0, 0, ['b1']), c('b1', 'b', 0, 1), c('b2', 'b', 1, 2, ['a1'])]
    expect(branchOrder(two, cyclic)).toEqual({ ordered: two, cycle: true })
    expect(branchOrder(two, [c('a1', 'a', 0, 0), c('b1', 'b', 1, 1, ['a1'])]).cycle).toBe(false)
  })
})
