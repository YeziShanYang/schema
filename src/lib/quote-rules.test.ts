import { describe, expect, it } from 'vitest'
import { endsInLeadIn, pickQuote, quotePickOrder, quoteProblem, wordCount } from './quote-rules'
import { exactQuoteSpan, indexPaperText, normalizeForMatch } from './quotes'

const paper = normalizeForMatch(`Theorem 1. With Ak = {A ⊆ V : 1 ≤ |A| ≤ k}, the two optima are
equal. Us = exp{−I(v; s)}, as shown. We compute the dot products of the query with all keys and apply a softmax function to obtain the weights.
The layer output is computed as follows: and so on. Each score is divided by \\(\\sqrt{d_{k}}\\) so that its scale stays stable during training.
The verifier accepts with probability at least two thirds on every yes instance of the problem.`)

describe('quote rules', () => {
  it('rejects equations, display math, fragments, lead-ins and unverified quotes', () => {
    const none = new Set<string>()
    expect(quoteProblem('Theorem 1. With Ak = {A ⊆ V : 1 ≤ |A| ≤ k}, the two optima are', paper, none)).toBe('equation')
    expect(quoteProblem('\\[s_{ij}=\\frac{q_i k_j}{\\sqrt{d_k}}\\] holds for every pair of positions in the input', paper, none)).toBe('display-math')
    expect(quoteProblem('The layer output is computed as follows:', paper, none)).toBe('short')
    expect(quoteProblem('We compute the dot products of the query with all keys and apply the', paper, none)).toBe('lead-in')
    expect(quoteProblem('A sentence of more than eight words that the paper never says anywhere.', paper, none)).toBe('unverified')
    expect(quoteProblem('', paper, none)).toBe('empty')
  })

  it('accepts a verified prose quote with inline math, counting words outside the math', () => {
    const q = 'Each score is divided by \\(\\sqrt{d_{k}}\\) so that its scale stays stable during training.'
    expect(wordCount(q)).toBe(13)
    expect(quoteProblem(q, paper, new Set())).toBeNull()
  })

  it('treats a trailing colon, comma or lead-in word as a lead-in, but not a closing formula', () => {
    expect(endsInLeadIn('the result is computed as follows:')).toBe(true)
    expect(endsInLeadIn('which we write as')).toBe(true)
    expect(endsInLeadIn('the two optima are')).toBe(true)
    expect(endsInLeadIn('before the softmax,')).toBe(true)
    expect(endsInLeadIn('we divide each by \\(\\sqrt{d_k}\\)')).toBe(false)
    expect(endsInLeadIn('the scale stays stable.')).toBe(false)
  })

  it('takes the first passing candidate and never gives two concepts the same quote', () => {
    const used = new Set<string>()
    const good = 'The verifier accepts with probability at least two thirds on every yes instance of the problem.'
    const first = pickQuote(['Us = exp{−I(v; s)}, as shown.', good], paper, used)
    expect(first.quote).toBe(good)
    expect(first.rejected.map((r) => r.problem)).toEqual(['equation'])
    const second = pickQuote([good], paper, used)
    expect(second).toEqual({ quote: '', rejected: [{ quote: good, problem: 'duplicate' }] })
  })
})

describe('quotes in the paper\'s own words', () => {
  const text =
    'We compute the dot products of the query with all keys, divide each by \\(\\sqrt{d_{k}}\\), and apply a softmax function to obtain the weights on the values. ' +
    'For large values of \\(d_{k}\\) the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.'
  const index = indexPaperText(text)

  it('restores math delimiters the model dropped when copying', () => {
    const copied = 'We compute the dot products of the query with all keys, divide each by \\sqrt{d_{k}}, and apply a softmax function'
    expect(exactQuoteSpan(copied, index)).toBe('We compute the dot products of the query with all keys, divide each by \\(\\sqrt{d_{k}}\\), and apply a softmax function')
  })

  it('widens a span that cuts into a formula to the whole formula, and keeps closing punctuation', () => {
    expect(exactQuoteSpan('values of d_{k} the dot products grow large in magnitude.', index)).toBe('values of \\(d_{k}\\) the dot products grow large in magnitude')
    expect(exactQuoteSpan('pushing the softmax into regions with tiny gradients.', index)).toBe('pushing the softmax into regions with tiny gradients.')
    expect(exactQuoteSpan('A sentence the paper never contains at all.', index)).toBeNull()
  })

  it('stores the exact span when picking, and its normalized form blocks the same passage for another concept', () => {
    const used = new Set<string>()
    const pick = pickQuote(['For large values of d_k the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.'], index, used)
    expect(pick.quote).toBe('For large values of \\(d_{k}\\) the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.')
    expect(pickQuote([pick.quote], index, used).rejected[0].problem).toBe('duplicate')
  })

  it('rejects a quote that starts mid-clause', () => {
    expect(quoteProblem('and decreasing it thereafter proportionally to the inverse square root of the step number.', index.norm, new Set())).toBe('fragment')
  })

  it('lets deep concepts pick first, keeping the model order within a depth', () => {
    const order = quotePickOrder([
      { id: 'a', depth: 'working' },
      { id: 'b', depth: 'deep' },
      { id: 'c', depth: 'skim' },
      { id: 'd', depth: 'deep' },
    ])
    expect(order.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})
