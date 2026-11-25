import { describe, expect, it } from 'vitest'

describe('linkTitle', () => {
  it('keeps a real title and replaces a raw URL with domain and path', async () => {
    const { linkTitle, prettyUrl } = await import('./links')
    expect(linkTitle('Softmax explained', 'https://example.org/a')).toBe('Softmax explained')
    expect(linkTitle('https://www.example.org/learn/softmax/?x=1', 'https://www.example.org/learn/softmax/?x=1')).toBe('example.org/learn/softmax')
    expect(linkTitle('', 'https://cs231n.github.io/neural-networks-1/')).toBe('cs231n.github.io/neural-networks-1')
    expect(prettyUrl('not a url')).toBe('not a url')
  })
})
