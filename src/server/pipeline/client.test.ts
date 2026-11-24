import { describe, expect, it } from 'vitest'
import { fetchPublicPage, retryAfterMs } from './client'

describe('fetchPublicPage', () => {
  it('sends a generic User-Agent and retries a 429 once after the backoff', async () => {
    const seen: { ua: string | null }[] = []
    const waits: number[] = []
    const responses = [new Response('slow down', { status: 429, headers: { 'Retry-After': '4' } }), new Response('<html>ok</html>', { status: 200 })]
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      seen.push({ ua: new Headers(init?.headers).get('User-Agent') })
      return responses.shift()!
    }) as typeof fetch
    const page = await fetchPublicPage('https://arxiv.org/html/2611.30998', undefined, fakeFetch, async (ms) => {
      waits.push(ms)
    })
    expect(page).toEqual({ status: 200, text: '<html>ok</html>' })
    expect(waits).toEqual([4000])
    expect(seen).toHaveLength(2)
    expect(seen[0].ua).toMatch(/^Mozilla\/5\.0 \(compatible; /)
  })

  it('returns a 404 without throwing or retrying', async () => {
    let calls = 0
    const fakeFetch = (async () => {
      calls++
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch
    expect(await fetchPublicPage('https://arxiv.org/html/x', undefined, fakeFetch, async () => {})).toEqual({ status: 404, text: '' })
    expect(calls).toBe(1)
  })

  it('bounds the Retry-After wait', () => {
    expect(retryAfterMs(null)).toBe(5000)
    expect(retryAfterMs('0')).toBe(2000)
    expect(retryAfterMs('600')).toBe(15000)
    expect(retryAfterMs('not a number or date')).toBe(5000)
  })
})
