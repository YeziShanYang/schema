import { describe, expect, it } from 'vitest'
import { nameMatch, splitSharedTopics } from './topics'

const names: Record<string, string> = {
  'attention-mechanism': 'Attention mechanism',
  'language-models': 'Language models',
  softmax: 'Softmax function',
}
const topicName = (k: string) => names[k] ?? ''

describe('nameMatch', () => {
  it('scores word overlap, ignoring case, stop words and plural s', () => {
    expect(nameMatch('Language Models', 'language model')).toBe(1)
    expect(nameMatch('Self-attention', 'Attention mechanism')).toBeCloseTo(1 / 3)
    expect(nameMatch('Auto-regressive generation', 'Language models')).toBe(0)
    expect(nameMatch('', 'Attention')).toBe(0)
  })
})

describe('splitSharedTopics', () => {
  it('keeps distinct topics untouched', () => {
    expect(
      splitSharedTopics(
        [
          { id: 'c1', name: 'Softmax', topicKey: 'softmax' },
          { id: 'c2', name: 'Self-attention', topicKey: 'attention-mechanism' },
        ],
        topicName,
      ),
    ).toEqual([])
  })

  it('splits the 1706.03762 collisions: best name match keeps the topic', () => {
    const splits = splitSharedTopics(
      [
        { id: 'c2', name: 'Encoder-decoder sequence-to-sequence models', topicKey: 'language-models' },
        { id: 'c3', name: 'Auto-regressive generation', topicKey: 'language-models' },
        { id: 'c4', name: 'Self-attention', topicKey: 'attention-mechanism' },
        { id: 'c7', name: 'Multi-head attention', topicKey: 'attention-mechanism' },
        { id: 'c11', name: 'Masked self-attention in the decoder', topicKey: 'attention-mechanism' },
      ],
      topicName,
    )
    expect(splits).toEqual([
      { id: 'c3', from: 'language-models', to: 'auto-regressive-generation' },
      { id: 'c7', from: 'attention-mechanism', to: 'multi-head-attention' },
      { id: 'c11', from: 'attention-mechanism', to: 'masked-self-attention-in-the-decoder' },
    ])
  })

  it('gives ties to the earlier concept', () => {
    const splits = splitSharedTopics(
      [
        { id: 'a', name: 'Gradient tricks', topicKey: 'softmax' },
        { id: 'b', name: 'Optimizer tricks', topicKey: 'softmax' },
      ],
      topicName,
    )
    expect(splits).toEqual([{ id: 'b', from: 'softmax', to: 'optimizer-tricks' }])
  })

  it('suffixes a new key that is already used in the paper', () => {
    const splits = splitSharedTopics(
      [
        { id: 'a', name: 'Attention mechanism', topicKey: 'attention-mechanism' },
        { id: 'b', name: 'Softmax', topicKey: 'attention-mechanism' },
        { id: 'c', name: 'Softmax', topicKey: 'softmax' },
      ],
      topicName,
    )
    expect(splits).toEqual([{ id: 'b', from: 'attention-mechanism', to: 'softmax-2' }])
  })

  it('leaves every concept with a distinct key', () => {
    const claims = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: i % 2 ? 'Same name' : `Concept ${i}`, topicKey: 'language-models' }))
    const moved = new Map(splitSharedTopics(claims, topicName).map((s) => [s.id, s.to]))
    const keys = claims.map((c) => moved.get(c.id) ?? c.topicKey)
    expect(new Set(keys).size).toBe(claims.length)
  })
})

describe('assignTopics (analyze job)', () => {
  it('gives every concept in a paper its own topic and creates the split topics', async () => {
    const { assignTopics } = await import('../server/pipeline/assign-topics')
    const existing = new Map([
      ['attention-mechanism', { name: 'Attention mechanism', level: 'core' as const }],
      ['multi-head-attention', { name: 'Multi-head attention', level: 'specialized' as const }],
    ])
    const { topicFor, newTopics } = assignTopics(
      [
        { id: 'c4', name: 'Self-attention', whyNeeded: 'The core operation.', topic: { key: 'attention-mechanism' } },
        { id: 'c7', name: 'Multi-head attention', whyNeeded: 'Runs attention in parallel heads.', topic: { key: 'attention-mechanism' } },
        { id: 'c11', name: 'Masked self-attention in the decoder', whyNeeded: 'Keeps generation causal.', topic: { key: 'attention-mechanism' } },
        { id: 'c2', name: 'Sequence models', whyNeeded: 'Background.', topic: { key: 'seq', name: 'Sequence models', level: 'foundation', description: 'Models over sequences.' } },
        { id: 'c3', name: 'Auto-regressive generation', whyNeeded: 'Output one token at a time.', topic: { key: 'seq' } },
      ],
      existing,
    )
    expect(topicFor).toEqual({
      c4: 'attention-mechanism',
      c7: 'multi-head-attention',
      c11: 'masked-self-attention-in-the-decoder',
      c2: 'seq',
      c3: 'auto-regressive-generation',
    })
    // An existing topic with the split key is reused, not recreated.
    expect(newTopics.has('multi-head-attention')).toBe(false)
    expect(newTopics.get('masked-self-attention-in-the-decoder')).toMatchObject({
      name: 'Masked self-attention in the decoder',
      level: 'core',
      description: 'Keeps generation causal.',
    })
    // A split from a new topic takes that topic's level.
    expect(newTopics.get('auto-regressive-generation')?.level).toBe('foundation')
    expect(newTopics.get('seq')?.name).toBe('Sequence models')
  })
})
