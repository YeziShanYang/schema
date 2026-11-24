import { describe, expect, it } from 'vitest'
import { acceptQuoteDisplay, quoteDisplayOverlap } from './quote-display'

const mangled = 'The metric gives ⟨A, B⟩g = g ia g jb Aij Bab and ∥A∥2g = ⟨A, A⟩g for every pair of tensors.'
const latex = 'The metric gives \\(\\langle A, B\\rangle_g = g^{ia} g^{jb} A_{ij} B_{ab}\\) and \\(\\|A\\|_g^2 = \\langle A, A\\rangle_g\\) for every pair of tensors.'

describe('acceptQuoteDisplay', () => {
  it('accepts the same sentence with its formulas as LaTeX', () => {
    expect(acceptQuoteDisplay(mangled, latex)).toBe(true)
    expect(quoteDisplayOverlap(mangled, latex)).toBe(1)
  })

  it('rejects a display whose words were changed', () => {
    const reworded = 'Using the inner product, \\(\\langle A, B\\rangle_g = g^{ia} g^{jb} A_{ij} B_{ab}\\) holds for all matrices we consider.'
    expect(acceptQuoteDisplay(mangled, reworded)).toBe(false)
  })

  it('rejects a display that drops part of the sentence', () => {
    expect(acceptQuoteDisplay(mangled, 'The metric gives \\(\\langle A, B\\rangle_g\\).')).toBe(false)
  })

  it('rejects a display with no math or identical to the quote', () => {
    expect(acceptQuoteDisplay(mangled, mangled)).toBe(false)
    expect(acceptQuoteDisplay('Plain words only.', 'Plain words only, really.')).toBe(false)
  })
})
