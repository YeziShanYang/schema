import { describe, expect, it } from 'vitest'
import { isNameSearch, matchPapers, searchWords, SEARCH_LIMIT, shortAuthors, type SearchablePaper } from './paper-search'

const paper = (arxivId: string, title: string, authors: string[] = [], status = 'ready'): SearchablePaper => ({ arxivId, title, authors, status })

const attention = paper('1706.03762', 'Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer'])
const resnet = paper('1512.03385', 'Deep Residual Learning for Image Recognition', ['Kaiming He', 'Xiangyu Zhang'])
const bert = paper('1810.04805', 'BERT: Pre-training of Deep Bidirectional Transformers', ['Jacob Devlin'])
const kernels = paper('math/0601001', 'Kernel Methods in Machine Learning', ['Bernhard Schölkopf', 'Alexander Smola'])

const ids = (list: SearchablePaper[]) => list.map((p) => p.arxivId)

describe('isNameSearch', () => {
  it.each(['attention', 'at', ' a b ', 'Vaswani', '1706.03', 'hep-th'])('searches by name for %j', (input) => {
    expect(isNameSearch(input)).toBe(true)
  })

  it.each(['', ' ', 'a', '  a  ', '1706.03762', 'arXiv:1706.03762v7', 'https://arxiv.org/abs/1706.03762', 'hep-th/9901001'])(
    'does not for %j',
    (input) => {
      expect(isNameSearch(input)).toBe(false)
    },
  )
})

describe('searchWords', () => {
  it('splits on any whitespace and folds case and accents', () => {
    expect(searchWords('  Schölkopf\tKERNEL  methods ')).toEqual(['scholkopf', 'kernel', 'methods'])
  })
})

describe('matchPapers', () => {
  const all = [attention, resnet, bert, kernels]

  it('matches title, authors and arXiv id, ignoring case', () => {
    expect(ids(matchPapers(all, 'ATTENTION'))).toEqual(['1706.03762'])
    expect(ids(matchPapers(all, 'vaswani'))).toEqual(['1706.03762'])
    expect(ids(matchPapers(all, '1512'))).toEqual(['1512.03385'])
    expect(ids(matchPapers(all, 'math/06'))).toEqual(['math/0601001'])
  })

  it('needs every word to match somewhere, in any field', () => {
    expect(ids(matchPapers(all, 'attention shazeer'))).toEqual(['1706.03762'])
    expect(ids(matchPapers(all, 'attention he'))).toEqual([])
    expect(ids(matchPapers(all, 'deep'))).toEqual(['1512.03385', '1810.04805'])
    expect(ids(matchPapers(all, 'deep devlin'))).toEqual(['1810.04805'])
  })

  it('ignores accents on either side', () => {
    expect(ids(matchPapers(all, 'scholkopf'))).toEqual(['math/0601001'])
    expect(ids(matchPapers(all, 'Schölkopf'))).toEqual(['math/0601001'])
  })

  it('lists only ready papers', () => {
    const queued = paper('2611.00001', 'Attention for Queued Papers', [], 'queued')
    const failed = paper('2611.00002', 'Attention That Failed', [], 'failed')
    expect(ids(matchPapers([queued, failed, attention], 'attention'))).toEqual(['1706.03762'])
  })

  it('ranks a title holding every word above one holding some, above author or id matches', () => {
    const byAuthor = paper('2001.00001', 'Graph Transformers', ['Grace Attention', 'Sam Sparse'])
    const some = paper('2001.00002', 'Attention in Graphs', ['Ada Sparse'])
    const every = paper('2001.00003', 'Sparse Attention Revisited', [])
    expect(ids(matchPapers([byAuthor, some, every], 'sparse attention'))).toEqual(['2001.00003', '2001.00002', '2001.00001'])
    // Only one word in the title still ranks above none.
    expect(ids(matchPapers([paper('2001.00004', 'Nothing here', ['Attention Person']), some], 'attention'))).toEqual(['2001.00002', '2001.00004'])
  })

  it('within a group, prefers words that start a title word, then keeps the given order', () => {
    const inside = paper('2002.00001', 'ResNet Variants', [])
    const start = paper('2002.00002', 'Network Pruning', [])
    const later = paper('2002.00003', 'Pruning a Net', [])
    expect(ids(matchPapers([inside, start, later], 'net'))).toEqual(['2002.00002', '2002.00003', '2002.00001'])
  })

  it('returns at most the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => paper(`2003.${String(i).padStart(5, '0')}`, `Attention study ${i}`))
    expect(matchPapers(many, 'attention')).toHaveLength(SEARCH_LIMIT)
    expect(ids(matchPapers(many, 'attention', 3))).toEqual(['2003.00000', '2003.00001', '2003.00002'])
  })

  it('returns nothing for an empty query or a paper with missing fields', () => {
    expect(matchPapers(all, '   ')).toEqual([])
    expect(ids(matchPapers([{ arxivId: '2004.00001', title: '', authors: null, status: 'ready' }], '2004'))).toEqual(['2004.00001'])
  })
})

describe('shortAuthors', () => {
  it('names the first author by the last word of their name', () => {
    expect(shortAuthors(['Ashish Vaswani', 'Noam Shazeer'])).toBe('Vaswani et al.')
    expect(shortAuthors(['Jacob Devlin'])).toBe('Devlin')
    expect(shortAuthors([' Yann  LeCun '])).toBe('LeCun')
    expect(shortAuthors([])).toBe('')
    expect(shortAuthors(undefined)).toBe('')
  })
})
