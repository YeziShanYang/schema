import { describe, expect, it } from 'vitest'
import { plural } from './utils'

describe('plural', () => {
  it('uses the singular only for one', () => {
    expect(plural(1, 'paper', 'papers')).toBe('1 paper')
    expect(plural(0, 'paper', 'papers')).toBe('0 papers')
    expect(plural(3, 'paper', 'papers')).toBe('3 papers')
  })
})
