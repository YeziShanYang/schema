import { describe, expect, it } from 'vitest'
import { buildHintIndex, conceptHint, hintText, type CheckedConcept } from './hints'

const row = (conceptId: string, paperId: string, conceptName: string, topicKey: string): CheckedConcept => ({
  conceptId,
  paperId,
  arxivId: `arxiv-${paperId}`,
  conceptName,
  topicKey,
})

const concept = (conceptId: string, paperId: string, name: string, topicKey: string) => ({ conceptId, paperId, name, topicKey })

describe('conceptHint', () => {
  it('points to another paper that checked the same topic', () => {
    const index = buildHintIndex([row('a1', 'pA', 'Softmax over scores', 'softmax-function')], [])
    expect(conceptHint(index, concept('b1', 'pB', 'The softmax', 'softmax-function'))).toEqual({
      kind: 'checked',
      paperId: 'pA',
      arxivId: 'arxiv-pA',
      conceptName: 'Softmax over scores',
    })
  })

  it('matches the same name across papers after folding case, accents, punctuation and plurals', () => {
    const index = buildHintIndex([row('a1', 'pA', 'Positional Encodings', 'positional-encoding-a')], [])
    expect(conceptHint(index, concept('b1', 'pB', 'positional encoding', 'positional-encoding-b'))?.kind).toBe('checked')
    const accents = buildHintIndex([row('a2', 'pA', 'Schrödinger equation', 't1')], [])
    expect(conceptHint(accents, concept('b2', 'pB', 'Schrodinger Equation', 't2'))?.kind).toBe('checked')
  })

  it('never hints from the same paper or the same concept', () => {
    const index = buildHintIndex([row('a1', 'pA', 'Softmax over scores', 'softmax-function')], [])
    expect(conceptHint(index, concept('a2', 'pA', 'Softmax over scores', 'softmax-function'))).toBeNull()
    expect(conceptHint(index, concept('a1', 'pB', 'Softmax over scores', 'softmax-function'))).toBeNull()
  })

  it('needs a shared topic or name: a related concept gets no hint', () => {
    const index = buildHintIndex([row('a1', 'pA', 'Attention mechanism', 'attention-mechanism')], [])
    expect(conceptHint(index, concept('b1', 'pB', 'Multi-head attention', 'multi-head-attention'))).toBeNull()
  })

  it('falls back to the profile, and a checked concept elsewhere wins over it', () => {
    const profileOnly = buildHintIndex([], ['softmax-function'])
    expect(conceptHint(profileOnly, concept('b1', 'pB', 'Softmax', 'softmax-function'))).toEqual({ kind: 'profile', topicKey: 'softmax-function' })
    const both = buildHintIndex([row('a1', 'pA', 'Softmax', 'softmax-function')], ['softmax-function'])
    expect(conceptHint(both, concept('b1', 'pB', 'Softmax', 'softmax-function'))?.kind).toBe('checked')
  })

  it('ignores empty topic keys and names', () => {
    const index = buildHintIndex([row('a1', 'pA', '', '')], [''])
    expect(conceptHint(index, concept('b1', 'pB', '', ''))).toBeNull()
  })

  it('names the first matching row, so callers can order rows by recency', () => {
    const index = buildHintIndex([row('a1', 'pNew', 'Softmax', 'softmax-function'), row('a2', 'pOld', 'Softmax', 'softmax-function')], [])
    expect(conceptHint(index, concept('b1', 'pB', 'Softmax', 'softmax-function'))).toMatchObject({ paperId: 'pNew' })
  })
})

describe('hintText', () => {
  it('uses the paper title when known and the arXiv id otherwise', () => {
    expect(hintText({ kind: 'checked', paperId: 'p', arxivId: '1706.03762', conceptName: 'x' }, 'Attention Is All You Need')).toBe(
      'You checked this in Attention Is All You Need',
    )
    expect(hintText({ kind: 'checked', paperId: 'p', arxivId: '1706.03762', conceptName: 'x' })).toBe('You checked this in arXiv 1706.03762')
    expect(hintText({ kind: 'profile', topicKey: 't' })).toBe('In your profile')
  })
})
