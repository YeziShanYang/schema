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

  it('a stage entered again after it ended keeps its first start and takes its last end', () => {
    let t = queuedTimings(0)
    for (const [stage, at] of [['text', 10], ['concepts', 20], ['overview', 30], ['explain', 40], ['verify', 50], ['overview', 60], ['verify', 70]] as const) {
      t = enterStage(t, stage, at)
    }
    expect(openStage(t)).toBe('verify')
    expect(t.overview).toEqual({ startedAt: 30, endedAt: 70 })
    expect(t.verify).toEqual({ startedAt: 50 })
    t = closeTimings(t, 90)
    expect(t.verify).toEqual({ startedAt: 50, endedAt: 90 })
    expect(runEndedAt(t)).toBe(90)
    expect(lastStartedStage(t)).toBe('verify')
  })

  it('a run that fails during the overview rewrite stopped in overview, not verify', () => {
    let t = queuedTimings(0)
    for (const [stage, at] of [['text', 10], ['concepts', 20], ['overview', 30], ['explain', 40], ['verify', 50], ['overview', 60]] as const) {
      t = enterStage(t, stage, at)
    }
    t = closeTimings(t, 65)
    expect(t.overview).toEqual({ startedAt: 30, endedAt: 65 })
    expect(t.verify).toEqual({ startedAt: 50, endedAt: 60 })
    expect(lastStartedStage(t)).toBe('overview')
  })
})
