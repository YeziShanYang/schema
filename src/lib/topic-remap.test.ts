import { describe, expect, it } from 'vitest'
import { planTopicMoves } from './topic-remap'

const names: Record<string, string> = {
  'word-embeddings': 'Word embeddings',
  'evaluation-metrics-accuracy-precision-recall': 'Evaluation metrics (accuracy, precision, recall)',
  'softmax-function': 'Softmax function',
  'linear-probes': 'Linear probes',
  'bleu-score': 'BLEU score',
}
const topicName = (k: string) => names[k] ?? ''

describe('planTopicMoves (topic-reuse migration)', () => {
  it('moves over-broad reuses to a topic named for the concept and leaves good ones', () => {
    const moves = planTopicMoves(
      [
        { id: 'c3', name: 'Positional encoding', topicKey: 'word-embeddings' },
        { id: 'c16', name: 'BLEU score', topicKey: 'evaluation-metrics-accuracy-precision-recall' },
        { id: 'c1', name: 'Softmax over scores', topicKey: 'softmax-function' },
        { id: 'c9', name: 'A concept whose topic row is missing', topicKey: 'gone' },
      ],
      topicName,
    )
    expect(moves).toEqual([
      { id: 'c3', from: 'word-embeddings', to: 'positional-encoding' },
      { id: 'c16', from: 'evaluation-metrics-accuracy-precision-recall', to: 'bleu-score' },
    ])
  })

  it('does not reuse an existing topic of another idea, and keeps keys distinct within the paper', () => {
    const moves = planTopicMoves(
      [
        { id: 'c5', name: 'Local R^2 score', topicKey: 'evaluation-metrics-accuracy-precision-recall' },
        { id: 'c6', name: 'Orthonormal embeddings assumption', topicKey: 'linear-probes' },
        { id: 'c7', name: 'Orthonormal embeddings assumption', topicKey: 'linear-probes' },
      ],
      (k) => (k === 'local-r-2-score' ? 'Coefficient of determination tables' : topicName(k)),
    )
    expect(moves).toEqual([
      { id: 'c5', from: 'evaluation-metrics-accuracy-precision-recall', to: 'local-r-2-score-topic' },
      { id: 'c6', from: 'linear-probes', to: 'orthonormal-embeddings-assumption' },
      { id: 'c7', from: 'linear-probes', to: 'orthonormal-embeddings-assumption-2' },
    ])
  })
})
