import { describe, expect, it } from 'vitest'
import { isQuoteVerified, normalizeForMatch, quoteScore } from './quotes'

describe('quote verification', () => {
  const paper = normalizeForMatch(
    'The label Ĥ is a least-squares quadratic on n noisy labels. We fit linear probes to galaxy em-\nbeddings from five pretrained encoders and intervene on this ﬁnal curvature term.',
  )

  it('matches exact quotes despite case, punctuation and line-break hyphens', () => {
    expect(quoteScore('We fit linear probes to galaxy embeddings from five pretrained encoders', paper)).toBe(1)
  })

  it('folds accents and ligatures', () => {
    expect(quoteScore('The label Ĥ is a least-squares quadratic on n noisy labels.', paper)).toBe(1)
    expect(quoteScore('intervene on this final curvature term', paper)).toBe(1)
  })

  it('scores invented quotes low', () => {
    expect(isQuoteVerified('Transformers revolutionized computer vision through massive pretraining runs', paper)).toBe(false)
  })

  it('gives partial credit when most of a quote survives extraction noise', () => {
    const s = quoteScore('We fit linear probes to galaxy embeddings from five pretrained encoders ∥x∥', paper)
    expect(s).toBeGreaterThan(0.6)
  })
})
