import { describe, expect, it } from 'vitest'
import { hasMath, normalizeMathMarkdown, parseMath } from './math'

describe('normalizeMathMarkdown', () => {
  it('rewrites math for remark-math and escapes other dollars', () => {
    expect(normalizeMathMarkdown('Cost $5, score \\(x^2\\).')).toBe('Cost \\$5, score $$x^2$$.')
    expect(normalizeMathMarkdown('Before\n\\[\\sum_i x_i\\]\nafter')).toBe('Before\n\n\n$$\n\\sum_i x_i\n$$\n\n\nafter')
  })
})

describe('parseMath', () => {
  it('reads \\( \\) and \\[ \\] with nested braces', () => {
    expect(parseMath('Scores \\(\\frac{QK^\\top}{\\sqrt{d_k}}\\) then')).toEqual([
      { type: 'text', value: 'Scores ' },
      { type: 'math', value: '\\frac{QK^\\top}{\\sqrt{d_k}}', display: false },
      { type: 'text', value: ' then' },
    ])
    expect(parseMath('\\[\\sum_i x_i\\]')).toEqual([{ type: 'math', value: '\\sum_i x_i', display: true }])
  })

  it('leaves currency alone', () => {
    expect(parseMath('It costs $5 and $10 a month.')).toEqual([{ type: 'text', value: 'It costs $5 and $10 a month.' }])
    expect(parseMath('Pay $ 5 now')).toEqual([{ type: 'text', value: 'Pay $ 5 now' }])
    expect(hasMath('between $3.50 and $4.00')).toBe(false)
  })

  it('reads $…$ and $$…$$ when no space follows the opening dollar', () => {
    expect(parseMath('where $x^2$ grows')).toEqual([
      { type: 'text', value: 'where ' },
      { type: 'math', value: 'x^2', display: false },
      { type: 'text', value: ' grows' },
    ])
    expect(parseMath('$$a+b$$')).toEqual([{ type: 'math', value: 'a+b', display: true }])
  })

  it('treats escaped dollars as text', () => {
    expect(parseMath('a \\$5 fee and \\$x\\$')).toEqual([{ type: 'text', value: 'a $5 fee and $x$' }])
  })

  it('leaves an unclosed delimiter as text', () => {
    expect(parseMath('broken \\(x + y')).toEqual([{ type: 'text', value: 'broken \\(x + y' }])
    expect(parseMath('only $x here')).toEqual([{ type: 'text', value: 'only $x here' }])
  })
})
