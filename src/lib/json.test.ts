import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './json'

describe('extractJsonObject', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('Here you go: {"a": {"b": 2}} thanks')).toEqual({ a: { b: 2 } })
  })
  it('returns null for arrays and garbage', () => {
    expect(extractJsonObject('[1,2]')).toBeNull()
    expect(extractJsonObject('not json')).toBeNull()
    expect(extractJsonObject('{"a": ')).toBeNull()
  })
})
