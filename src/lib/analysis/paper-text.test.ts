import { describe, expect, it } from 'vitest'
import { cutAtReferences, preparePaperText } from './paper-text'

describe('preparePaperText', () => {
  const body = 'Introduction\n' + 'Some text about models. '.repeat(200)
  it('cuts at a References heading after the first 15% of the text', () => {
    const raw = `${body}\nReferences\n[1] A. Author. A paper.\nAppendix A\nMore.`
    const { text, cut } = cutAtReferences(raw)
    expect(cut).toBe(true)
    expect(text.endsWith('models.')).toBe(true)
    expect(text).not.toContain('[1] A. Author')
  })

  it('ignores a References line inside an early table of contents', () => {
    const raw = `Contents\nReferences\n${body}`
    expect(cutAtReferences(raw).cut).toBe(false)
  })

  it('accepts numbered and uppercase headings', () => {
    expect(cutAtReferences(`${body}\n7 REFERENCES\n[1] x`).cut).toBe(true)
    expect(cutAtReferences(`${body}\nBibliography\n[1] x`).cut).toBe(true)
  })

  it('caps very long text', () => {
    const r = preparePaperText('x'.repeat(1000), 100)
    expect(r.text.length).toBe(100)
    expect(r.truncated).toBe(true)
  })
})
