import { describe, expect, it } from 'vitest'
import { capState, CAP_WINDOW_MS, formatSlotTime } from './cap'

describe('capState', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  it('counts only requests inside the rolling window', () => {
    const s = capState(['2026-11-24T11:00:00Z', '2026-11-23T11:59:00Z', now - 1000], now, 5)
    expect(s.used).toBe(2)
    expect(s.allowed).toBe(true)
    expect(s.remaining).toBe(3)
  })
  it('blocks at the cap and reports when a slot frees up', () => {
    const times = [1, 2, 3, 4, 5].map((h) => now - h * 60 * 60 * 1000)
    const s = capState(times, now, 5)
    expect(s.allowed).toBe(false)
    expect(s.nextSlotAt).toBe(now - 5 * 60 * 60 * 1000 + CAP_WINDOW_MS)
  })
  it('accepts unix seconds', () => {
    expect(capState([Math.floor((now - 1000) / 1000)], now, 5).used).toBe(1)
  })
})

describe('formatSlotTime', () => {
  // Local-time dates, so the result does not depend on the machine's zone.
  const now = new Date(2026, 10, 24, 20, 0).getTime()
  it('names a time today plainly and one after midnight as tomorrow', () => {
    expect(formatSlotTime(new Date(2026, 10, 24, 22, 30).getTime(), now, 'en-US')).toBe('10:30 PM')
    expect(formatSlotTime(new Date(2026, 10, 25, 7, 5).getTime(), now, 'en-US')).toBe('7:05 AM tomorrow')
  })
  it('names the weekday for anything later', () => {
    expect(formatSlotTime(new Date(2026, 10, 27, 9, 0).getTime(), now, 'en-US')).toBe('Friday 9:00 AM')
  })
})
