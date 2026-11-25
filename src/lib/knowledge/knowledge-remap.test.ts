import { describe, expect, it } from 'vitest'
import { planKnowledgeRemap } from './knowledge-remap'

const concepts = [
  { conceptId: 'new1', name: 'Scaled dot-product attention', topicKey: 'scaled-dot-product-attention' },
  { conceptId: 'new2', name: 'Positional encodings', topicKey: 'positional-encoding' },
]

describe('planKnowledgeRemap', () => {
  it('moves a row to the new concept with the same normalized name, taking its name and topic', () => {
    const plan = planKnowledgeRemap([{ recordId: 'r1', userId: 'u1', conceptId: 'old1', conceptName: 'Scaled Dot-Product Attention' }], concepts)
    expect(plan).toEqual({
      moves: [{ recordId: 'r1', data: { conceptId: 'new1', conceptName: 'Scaled dot-product attention', topicKey: 'scaled-dot-product-attention', stale: false } }],
      deletes: [],
    })
  })

  it('matches plurals, marks unmatched rows stale once, and leaves rows on current concepts alone', () => {
    const plan = planKnowledgeRemap(
      [
        { recordId: 'r1', userId: 'u1', conceptId: 'old2', conceptName: 'Positional encoding' },
        { recordId: 'r2', userId: 'u1', conceptId: 'old3', conceptName: 'BLEU score' },
        { recordId: 'r3', userId: 'u1', conceptId: 'old4', conceptName: 'Label smoothing', stale: true },
        { recordId: 'r4', userId: 'u2', conceptId: 'new1', conceptName: 'Scaled dot-product attention' },
      ],
      concepts,
    )
    expect(plan.moves.map((m) => [m.recordId, 'conceptId' in m.data ? m.data.conceptId : 'stale'])).toEqual([
      ['r1', 'new2'],
      ['r2', 'stale'],
    ])
    expect(plan.deletes).toEqual([])
  })

  it('deletes a second row of the same reader that lands on a concept they already have', () => {
    const plan = planKnowledgeRemap(
      [
        { recordId: 'keep', userId: 'u1', conceptId: 'new1', conceptName: 'Scaled dot-product attention' },
        { recordId: 'dup', userId: 'u1', conceptId: 'old1', conceptName: 'scaled dot-product attention' },
        { recordId: 'a', userId: 'u2', conceptId: 'old1', conceptName: 'Positional encoding' },
        { recordId: 'b', userId: 'u2', conceptId: 'old9', conceptName: 'Positional Encodings' },
      ],
      concepts,
    )
    expect(plan.deletes.sort()).toEqual(['b', 'dup'])
    expect(plan.moves.map((m) => m.recordId)).toEqual(['a'])
  })
})
