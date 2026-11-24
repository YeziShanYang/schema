import { describe, expect, it } from 'vitest'
import { categoryName, shortTitle, suggestWorkspaceName } from './categories'

describe('categoryName', () => {
  it('maps exact categories', () => {
    expect(categoryName('cs.LG')).toBe('Machine Learning')
    expect(categoryName('cs.CL')).toBe('Natural Language Processing')
    expect(categoryName('cs.CV')).toBe('Computer Vision')
    expect(categoryName('stat.ML')).toBe('Statistical Machine Learning')
    expect(categoryName('quant-ph')).toBe('Quantum Physics')
  })
  it('falls back to the archive', () => {
    expect(categoryName('cs.XY')).toBe('Computer Science')
    expect(categoryName('math.KT')).toBe('Mathematics')
    expect(categoryName('physics.optics')).toBe('Physics')
    expect(categoryName('astro-ph.XX')).toBe('Astrophysics')
    expect(categoryName('hep-foo')).toBe('High Energy Physics')
  })
  it('returns empty for unknown or missing codes', () => {
    expect(categoryName('')).toBe('')
    expect(categoryName('zz.TOP')).toBe('')
  })
})

describe('suggestWorkspaceName', () => {
  it('prefers the category, then a shortened title', () => {
    expect(suggestWorkspaceName('cs.LG', 'Anything')).toBe('Machine Learning')
    expect(suggestWorkspaceName('', 'Attention Is All You Need')).toBe('Attention Is All You Need')
    expect(suggestWorkspaceName('zz', 'Curvature Mismatch: Local Errors in Galaxy Property Estimation')).toBe('Curvature Mismatch')
    expect(suggestWorkspaceName('', '')).toBe('New workspace')
  })
  it('shortens long titles to five words', () => {
    expect(shortTitle('One two three four five six seven')).toBe('One two three four five…')
  })
})
