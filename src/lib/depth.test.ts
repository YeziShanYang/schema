import { describe, expect, it } from 'vitest'
import { foundationDepth } from './depth'

describe('foundationDepth', () => {
  it('caps a foundation with no prerequisites at working', () => {
    // Total variation distance in 2611.31236, Digamma function in 2611.30998.
    expect(foundationDepth('deep', [], 'foundation')).toBe('working')
    expect(foundationDepth('working', [], 'foundation')).toBe('working')
    expect(foundationDepth('skim', [], 'foundation')).toBe('skim')
  })

  it('keeps deep for a concept with prerequisites, or one whose topic is not a foundation', () => {
    // Gaussian mutual information in 2611.30998 builds on two concepts.
    expect(foundationDepth('deep', ['c2', 'c3'], 'foundation')).toBe('deep')
    expect(foundationDepth('deep', [], 'specialized')).toBe('deep')
    expect(foundationDepth('deep', [], 'core')).toBe('deep')
    expect(foundationDepth('deep', [], undefined)).toBe('deep')
  })
})
