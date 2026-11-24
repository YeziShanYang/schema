import { describe, expect, it } from 'vitest'
import { contentWords, nameMatch, normalizeConceptName, sharesContentWord, splitSharedTopics } from './topics'

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

describe('sharesContentWord (topic reuse rule)', () => {
  it('rejects the over-broad reuses found in the quality evaluation', () => {
    expect(sharesContentWord('Positional encoding', 'Word embeddings')).toBe(false)
    expect(sharesContentWord('BLEU score', 'Evaluation metrics (accuracy, precision, recall)')).toBe(false)
    expect(sharesContentWord('Local R^2 score', 'Evaluation metrics (accuracy, precision, recall)')).toBe(false)
    expect(sharesContentWord('Local R^2 score', 'BLEU score')).toBe(false)
    expect(sharesContentWord('Orthonormal embeddings assumption', 'Linear probes')).toBe(false)
  })

  it('accepts names that share a distinguishing word, after stop words and plurals', () => {
    expect(sharesContentWord('Softmax over scores', 'Softmax function')).toBe(true)
    expect(sharesContentWord('Eigenvalues of the sample covariance', 'Eigenvalues and eigenvectors')).toBe(true)
    expect(sharesContentWord("Jensen's inequality", 'Jensen inequality')).toBe(true)
  })

  it('does not count generic head nouns or hyphenated parts as a shared idea', () => {
    expect(sharesContentWord('Random matrices', 'Random variables')).toBe(false)
    expect(sharesContentWord('Contrastive loss', 'Loss functions')).toBe(false)
    expect(sharesContentWord('Entropy', 'Cross-entropy loss')).toBe(false)
    expect(sharesContentWord('Sample covariance matrix', 'Vectors and matrices')).toBe(false)
  })

  it('compares a name made only of generic words by all its words', () => {
    expect(contentWords('Loss functions').size).toBe(0)
    expect(sharesContentWord('Loss function', 'Loss functions')).toBe(true)
    expect(sharesContentWord('Probability distribution', 'Probability distributions')).toBe(true)
  })
})

describe('normalizeConceptName', () => {
  it('folds case, accents, punctuation and plurals', () => {
    expect(normalizeConceptName('Positional Encodings')).toBe(normalizeConceptName('positional encoding'))
    expect(normalizeConceptName('Rényi entropy')).toBe('renyi entropy')
    expect(normalizeConceptName('Scaled dot-product attention')).toBe(normalizeConceptName('scaled dot-product attention.'))
    expect(normalizeConceptName('Random matrices')).toBe('random matrix')
  })
})

describe('assignTopics (analyze job)', () => {
  it('gives every concept in a paper its own topic and creates the split topics', async () => {
    const { assignTopics } = await import('../server/pipeline/assign-topics')
    const existing = new Map([
      ['attention-mechanism', { name: 'Attention mechanism', level: 'core' as const }],
      ['multi-head-attention', { name: 'Multi-head attention', level: 'specialized' as const }],
    ])
    const { topicFor, newTopics, rejected } = assignTopics(
      [
        { id: 'c4', name: 'Attention weights', whyNeeded: 'The core operation.', topic: { key: 'attention-mechanism' } },
        { id: 'c7', name: 'Multi-head attention', whyNeeded: 'Runs attention in parallel heads.', topic: { key: 'attention-mechanism' } },
        { id: 'c11', name: 'Masked attention in the decoder', whyNeeded: 'Keeps generation causal.', topic: { key: 'attention-mechanism' } },
        { id: 'c2', name: 'Sequence models', whyNeeded: 'Background.', topic: { key: 'seq', name: 'Sequence models', level: 'foundation', description: 'Models over sequences.' } },
        { id: 'c3', name: 'Auto-regressive generation', whyNeeded: 'Output one token at a time.', topic: { key: 'seq' } },
      ],
      existing,
    )
    expect(rejected).toEqual([])
    expect(topicFor).toEqual({
      c4: 'attention-mechanism',
      c7: 'multi-head-attention',
      c11: 'masked-attention-in-the-decoder',
      c2: 'seq',
      c3: 'auto-regressive-generation',
    })
    // An existing topic with the split key is reused, not recreated.
    expect(newTopics.has('multi-head-attention')).toBe(false)
    expect(newTopics.get('masked-attention-in-the-decoder')).toMatchObject({
      name: 'Masked attention in the decoder',
      level: 'core',
      description: 'Keeps generation causal.',
    })
    // A split from a new topic takes that topic's level.
    expect(newTopics.get('auto-regressive-generation')?.level).toBe('foundation')
    expect(newTopics.get('seq')?.name).toBe('Sequence models')
  })

  it('accepts a reuse only when the names share a content word, otherwise names a topic for the concept', async () => {
    const { assignTopics } = await import('../server/pipeline/assign-topics')
    const existing = new Map([
      ['word-embeddings', { name: 'Word embeddings', level: 'core' as const, description: 'Dense vector representations of tokens.' }],
      ['evaluation-metrics', { name: 'Evaluation metrics (accuracy, precision, recall)', level: 'foundation' as const, description: 'Measuring classifier quality.' }],
      ['softmax-function', { name: 'Softmax function', level: 'foundation' as const, description: 'Scores to probabilities.' }],
    ])
    const { topicFor, newTopics, rejected } = assignTopics(
      [
        { id: 'c1', name: 'Positional encoding', whyNeeded: 'The paper adds positions to embeddings.', topic: { key: 'word-embeddings', description: 'Vectors that tell a model where each token sits.' } },
        { id: 'c2', name: 'BLEU score', whyNeeded: 'Results are reported in BLEU.', topic: { key: 'evaluation-metrics' } },
        { id: 'c3', name: 'Softmax over scores', whyNeeded: 'Weights come from a softmax.', topic: { key: 'softmax-function' } },
      ],
      existing,
    )
    expect(topicFor).toEqual({ c1: 'positional-encoding', c2: 'bleu-score', c3: 'softmax-function' })
    expect(rejected.map((r) => [r.id, r.from, r.to])).toEqual([
      ['c1', 'word-embeddings', 'positional-encoding'],
      ['c2', 'evaluation-metrics', 'bleu-score'],
    ])
    // The model's own description is used when it gave one, else the concept's why.
    expect(newTopics.get('positional-encoding')).toMatchObject({ name: 'Positional encoding', level: 'core', description: 'Vectors that tell a model where each token sits.', origin: 'paper' })
    expect(newTopics.get('bleu-score')).toMatchObject({ name: 'BLEU score', level: 'foundation', description: 'Results are reported in BLEU.' })
  })

  it('lists foundation and core topics first in the prompt, with short descriptions, at most 150', async () => {
    const { promptTopics, MAX_TOPICS_IN_PROMPT } = await import('../server/pipeline/assign-topics')
    const many = Array.from({ length: 200 }, (_, i) => ({
      key: `t${i}`,
      name: `Topic ${i}`,
      level: (i % 3 === 0 ? 'specialized' : i % 3 === 1 ? 'core' : 'foundation') as 'specialized' | 'core' | 'foundation',
      description: 'x'.repeat(120),
      origin: (i < 100 ? 'paper' : 'starter') as 'paper' | 'starter',
    }))
    const list = promptTopics(many)
    expect(list).toHaveLength(MAX_TOPICS_IN_PROMPT)
    const levels = list.map((t) => many.find((m) => m.key === t.key)!.level)
    expect(levels.indexOf('specialized')).toBeGreaterThan(levels.lastIndexOf('foundation'))
    expect(levels.indexOf('specialized')).toBeGreaterThan(levels.lastIndexOf('core'))
    // Within a level, starter topics come first.
    expect(many.find((m) => m.key === list[0].key)!.origin).toBe('starter')
    expect(list[0].description.length).toBeLessThanOrEqual(80)
  })
})
