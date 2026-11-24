import { describe, expect, it } from 'vitest'
import { cleanTitle } from './Markdown'

describe('cleanTitle', () => {
  it('drops site suffixes after a separator or a trailing domain', () => {
    expect(cleanTitle('Introduction to Large Language Models  |  Machine Learning  |  Google for Developers')).toBe('Introduction to Large Language Models')
    expect(cleanTitle('An Introduction to Recurrent Neural Networks for Beginners - victorzhou.com')).toBe('An Introduction to Recurrent Neural Networks for Beginners')
    expect(cleanTitle('Softmax · Docs')).toBe('Softmax · Docs') // too short once trimmed, so kept whole
    expect(cleanTitle('A beginner guide')).toBe('A beginner guide')
  })
})
