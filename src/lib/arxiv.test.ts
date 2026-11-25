import { describe, expect, it } from 'vitest'
import { arxivFromSlug, arxivSlug, parseArxivId } from './arxiv'

describe('parseArxivId', () => {
  it.each([
    ['2611.29002', '2611.29002', ''],
    ['2611.29002v1', '2611.29002', 'v1'],
    ['1706.03762', '1706.03762', ''],
    ['arXiv:1706.03762v7', '1706.03762', 'v7'],
    ['https://arxiv.org/abs/2611.29224', '2611.29224', ''],
    ['https://arxiv.org/pdf/2611.29224v1', '2611.29224', 'v1'],
    ['arxiv.org/pdf/1706.03762.pdf', '1706.03762', ''],
    ['https://arxiv.org/html/2611.29002v1#S3', '2611.29002', 'v1'],
    ['https://export.arxiv.org/abs/2611.29002?context=cs', '2611.29002', ''],
    ['hep-th/9901001', 'hep-th/9901001', ''],
    ['math.AG/0601001v2', 'math.AG/0601001', 'v2'],
    ['https://arxiv.org/abs/hep-th/9901001', 'hep-th/9901001', ''],
    ['  2611.29002  ', '2611.29002', ''],
  ])('parses %s', (input, id, version) => {
    expect(parseArxivId(input)).toEqual({ id, version })
  })

  it.each(['', 'hello', '2611.290', '261.29002', 'https://example.com/abs/2611.29002', '2611.29002/../x', 'hep-th/99010'])(
    'rejects %s',
    (input) => {
      expect(parseArxivId(input)).toBeNull()
    },
  )

  it('round-trips slugs without dots or slashes', () => {
    expect(arxivSlug('math.AG/0601001')).toBe('math~AG_0601001')
    expect(arxivSlug('2611.29002')).toBe('2611~29002')
    expect(arxivFromSlug(arxivSlug('math.AG/0601001'))).toBe('math.AG/0601001')
    expect(arxivFromSlug(arxivSlug('2611.29002'))).toBe('2611.29002')
    // Links typed with a plain dot still resolve.
    expect(arxivFromSlug('2611.29002')).toBe('2611.29002')
  })
})
