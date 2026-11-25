import { describe, expect, it } from 'vitest'
import { firstSentence, indexSentences, paperSentences, sentenceAt, sentenceEnd } from './sentences'
import { indexPaperText } from './quotes'

describe('sentence boundaries', () => {
  it('ends a sentence at a period before a capital, and at a line break', () => {
    const raw = 'The first one ends here. The second one\ngoes on another line.'
    expect(paperSentences(raw).map((s) => s.text)).toEqual(['The first one ends here.', 'The second one', 'goes on another line.'])
  })

  it('does not split inside math, after an abbreviation or initial, or before a lowercase word', () => {
    const raw = 'The map \\(f(x)=x.y\\) is smooth (Fig. 4D) as in Smith et al. (2016) and A. Vaswani, e.g. here. Next sentence.'
    expect(paperSentences(raw).map((s) => s.text)).toEqual([
      'The map \\(f(x)=x.y\\) is smooth (Fig. 4D) as in Smith et al. (2016) and A. Vaswani, e.g. here.',
      'Next sentence.',
    ])
  })

  it('keeps a closing bracket or quote with the sentence it ends', () => {
    const raw = 'which is PSPACE-complete [SM73, Theorem 4.3]. In a formula each quantifier ranges over one variable.'
    expect(sentenceEnd(raw, 0)).toBe(raw.indexOf(' In a formula'))
    expect(paperSentences('He said “stop.” Then he left.').map((s) => s.text)).toEqual(['He said “stop.”', 'Then he left.'])
  })

  it('takes the first sentence of a short text', () => {
    expect(firstSentence('The optimal guessing factor is the value of a linear program. Its dual gives the lower bounds.')).toBe(
      'The optimal guessing factor is the value of a linear program.',
    )
    expect(firstSentence('')).toBe('')
  })

  it('finds the sentence that holds an offset, and none in the space between sentences', () => {
    const raw = 'The first one ends here. The second one\n\ngoes on another line.'
    const index = indexPaperText(raw)
    const list = indexSentences(index)
    expect(indexSentences(index)).toBe(list)
    expect(sentenceAt(list, raw.indexOf('one ends'))?.text).toBe('The first one ends here.')
    expect(sentenceAt(list, raw.indexOf('second'))?.text).toBe('The second one')
    expect(sentenceAt(list, raw.indexOf('another'))?.start).toBe(raw.indexOf('goes'))
    expect(sentenceAt(list, raw.indexOf('\n') + 1)).toBeNull()
  })
})
