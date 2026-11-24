import { describe, expect, it } from 'vitest'
import { closeTimings, enterStage, lastStartedStage, openStage, queuedTimings, runEndedAt, runStartedAt, stageDurations } from './timings'

describe('stage timings', () => {
  it('entering a stage ends the open one at the same instant', () => {
    let t = queuedTimings(1000)
    t = enterStage(t, 'text', 1500)
    t = enterStage(t, 'concepts', 4000)
    expect(t).toEqual({
      queued: { startedAt: 1000, endedAt: 1500 },
      text: { startedAt: 1500, endedAt: 4000 },
      concepts: { startedAt: 4000 },
    })
    expect(openStage(t)).toBe('concepts')
  })

  it('re-entering the open stage keeps its start, so a retried step counts its delay', () => {
    const t = enterStage(queuedTimings(0), 'text', 100)
    expect(enterStage(t, 'text', 5000)).toEqual(t)
  })

  it('does not mutate its input', () => {
    const t = queuedTimings(0)
    enterStage(t, 'text', 10)
    closeTimings(t, 10)
    expect(t).toEqual({ queued: { startedAt: 0 } })
  })

  it('closing ends the open stage and fixes the total', () => {
    let t = enterStage(queuedTimings(0), 'text', 200)
    t = closeTimings(t, 900)
    expect(openStage(t)).toBeNull()
    expect(lastStartedStage(t)).toBe('text')
    expect(runStartedAt(t)).toBe(0)
    expect(runEndedAt(t)).toBe(900)
    expect(stageDurations(t, 99_999)).toEqual({ stages: { queued: 200, text: 700 }, totalMs: 900 })
  })

  it('measures an open stage and the total up to now', () => {
    const t = enterStage(queuedTimings(0), 'text', 200)
    expect(runEndedAt(t)).toBeNull()
    expect(stageDurations(t, 1200)).toEqual({ stages: { queued: 200, text: 1000 }, totalMs: 1200 })
  })

  it('papers analyzed before timings existed have none', () => {
    expect(stageDurations(undefined)).toEqual({ stages: {}, totalMs: null })
    expect(runStartedAt({})).toBeNull()
    expect(openStage(null)).toBeNull()
    // A run that started without a queued mark (queued before this field existed) still works.
    expect(enterStage(undefined, 'text', 5)).toEqual({ text: { startedAt: 5 } })
  })
})
