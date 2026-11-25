import { describe, expect, it } from 'vitest'
import { roleOverlap, roleRestatesWhy } from './plain-role'

/** Roles and why-needed lines as stored for 1706.03762, 2611.29002 and 2611.30998. */
describe('roleRestatesWhy', () => {
  it('hides a role that says the why-needed line again', () => {
    expect(
      roleRestatesWhy(
        'Input and output tokens are converted into learned vectors before any attention is applied.',
        'Input and output tokens are first converted into learned dense vectors before any attention is applied.',
      ),
    ).toBe(true)
    // 7 of 12 content words.
    expect(
      roleRestatesWhy(
        'Each layer includes a feed-forward sub-network applied separately to each position, built from two linear maps with a ReLU between them.',
        'Each layer contains a position-wise feed-forward sub-network made of two linear maps with a ReLU between them.',
      ),
    ).toBe(true)
    // 6 of 11.
    expect(
      roleRestatesWhy(
        'The Transformer keeps the encoder-decoder layout: the encoder reads the input and the decoder produces the output from it.',
        'The Transformer keeps the encoder-decoder layout, mapping an input sequence to representations and generating the output from them.',
      ),
    ).toBe(true)
  })

  it('keeps a role that adds something of its own', () => {
    // Half its words: the role adds what the comparison shows.
    const topK = ['Compares conditional and unconditional logits on their top-k tokens to show they are highly aligned.', 'The alignment measure compares conditional and unconditional logits only on their union of top-k coordinates, which is needed to read Figure 3 and Finding 2.'] as const
    expect(roleOverlap(...topK)).toBe(0.5)
    expect(roleRestatesWhy(...topK)).toBe(false)
    expect(
      roleRestatesWhy(
        'This is the exact attention operation used throughout the model, with scaling to keep softmax gradients from becoming very small.',
        'This is the exact attention operation used everywhere in the model, including the softmax of scaled query-key products applied to values.',
      ),
    ).toBe(false)
    expect(
      roleRestatesWhy(
        'Expectations and variances quantify the average size of the bias and how much it fluctuates across samples.',
        'The central results are expected excesses and their variances, such as the mean and null variance of the spurious information.',
      ),
    ).toBe(false)
  })

  it('leaves math out of the comparison, and keeps a role with no content words', () => {
    expect(roleOverlap('Softmax turns \\(\\mathrm{logits}\\) into weights.', 'Softmax turns scores into weights.')).toBe(1)
    expect(roleRestatesWhy('\\(x\\)', '\\(x\\)')).toBe(false)
    expect(roleRestatesWhy('', 'Anything at all.')).toBe(false)
  })
})
