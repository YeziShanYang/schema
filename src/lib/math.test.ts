import { describe, expect, it } from 'vitest'
import { hasMath, nameMath, normalizeMathMarkdown, parseMath } from './math'

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

describe('nameMath', () => {
  it('wraps bare superscripts and subscripts in concept names', () => {
    expect(nameMath('Local R^2 score')).toBe('Local \\(R^2\\) score')
    expect(nameMath('Scaling by d_k')).toBe('Scaling by \\(d_k\\)')
    expect(nameMath('L^{2} norm and x_i^2')).toBe('\\(L^{2}\\) norm and \\(x_i^2\\)')
    expect(nameMath('R^2-based ranking (R^2)')).toBe('\\(R^2\\)-based ranking (\\(R^2\\))')
  })

  it('leaves plain names and names with math alone', () => {
    expect(nameMath('Self-attention')).toBe('Self-attention')
    expect(nameMath('word_piece tokens and snake_case_names')).toBe('word_piece tokens and snake_case_names')
    expect(nameMath('Local \\(R^2\\) score')).toBe('Local \\(R^2\\) score')
    expect(nameMath('')).toBe('')
    expect(parseMath(nameMath('Local R^2 score')).filter((s) => s.type === 'math')).toEqual([{ type: 'math', value: 'R^2', display: false }])
  })
})
