import { describe, expect, it } from 'vitest'
import { recommendedSequence, type SeqConcept } from './sequence'
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

const statuses = (m: Record<string, KnowledgeStatus>) => (topicKey: string) => m[topicKey] ?? null

describe('recommendedSequence', () => {
  it('orders branches by mean tier, then the model order', () => {
    const s = recommendedSequence(branches, concepts, statuses({}))
    expect(s.steps.map((x) => x.branchKey)).toEqual(['math', 'attn', 'arch']) // means 0, 1.5, 2
    expect(s.steps.map((x) => x.index)).toEqual([1, 2, 3])
  })

  it('breaks mean-tier ties with the model branch order', () => {
    const tie = [c('a', 'arch', 1, 0), c('b', 'attn', 1, 1)]
    expect(recommendedSequence(branches, tie, statuses({})).steps.map((x) => x.branchKey).slice(0, 2)).toEqual(['attn', 'arch'])
  })

  it('orders concepts by tier, then branch order, then model order', () => {
    const s = recommendedSequence(branches, concepts, statuses({}))
    expect(s.concepts.map((x) => x.key)).toEqual(['softmax', 'dot', 'attention', 'posenc', 'scaled', 'multihead'])
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

  it('jumps past a blocked concept to the first ready one', () => {
    const s = recommendedSequence(branches, [c('x', 'math', 0, 0), c('y', 'attn', 1, 1, ['x']), c('z', 'arch', 1, 2)], statuses({ 't-x': 'known' }))
    expect(s.nextUp?.key).toBe('y')
    const blocked = recommendedSequence(branches, [c('y', 'attn', 1, 1, ['x']), c('x', 'math', 2, 0), c('z', 'arch', 1, 2)], statuses({}))
    expect(blocked.nextUp?.key).toBe('z') // y waits for x; z has no prerequisites
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
