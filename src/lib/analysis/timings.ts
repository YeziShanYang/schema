/**
 * Per-stage timings of a paper's analysis, stored on `PaperData.timings`.
 *
 * A stage's span is the time the paper record showed that stage to readers:
 * `queued` from the request (analyzePaper or retryPaper) to the job's first
 * tick, then `text`, `concepts`, `overview`, `explain` and `verify` as the
 * job moves on. A stage's queued record writes are flushed after the job has
 * already advanced `stage`, so they count toward the next stage, as readers
 * see it. A retried step stays in its stage, so the retry delay counts too.
 * When verify asks for the overview to be rewritten, the job goes back to
 * `overview` and then `verify` again: a stage entered twice keeps its first
 * start and its last end, so its span covers both visits (and the stages
 * between them).
 *
 * Every helper is pure and returns a new object, so the job can compute a
 * patch from the record it loaded and the page can measure elapsed time.
 */

import type { StageTimings, TimedStage } from '../../types'

export const TIMED_STAGES: readonly TimedStage[] = ['queued', 'text', 'concepts', 'overview', 'explain', 'verify']

/** The stage that has started and not ended, if any. */
export function openStage(t: StageTimings | null | undefined): TimedStage | null {
  if (!t) return null
  for (let i = TIMED_STAGES.length - 1; i >= 0; i--) {
    const s = TIMED_STAGES[i]
    const span = t[s]
    if (span && !span.endedAt) return s
  }
  return null
}

/**
 * The stage the run is in or stopped in: the open stage, or else the one that
 * ended last (a failed run's stage is closed at the moment it failed). After
 * an overview rewrite this is `overview` or `verify`, whichever came last.
 */
export function lastStartedStage(t: StageTimings | null | undefined): TimedStage | null {
  if (!t) return null
  const open = openStage(t)
  if (open) return open
  let last: TimedStage | null = null
  let at = -Infinity
  for (const s of TIMED_STAGES) {
    const span = t[s]
    if (!span) continue
    const end = span.endedAt ?? span.startedAt
    if (end >= at) {
      at = end
      last = s
    }
  }
  return last
}

/**
 * Ends whatever stage is open and starts `stage`. Entering the stage that is
 * already open changes nothing, so a retried step keeps its start time. A
 * stage entered again after it ended reopens with its first start, so it
 * ends with its last end.
 */
export function enterStage(t: StageTimings | null | undefined, stage: TimedStage, now: number): StageTimings {
  const out: StageTimings = { ...(t ?? {}) }
  const open = openStage(out)
  if (open === stage) return out
  if (open) out[open] = { ...out[open]!, endedAt: now }
  out[stage] = { startedAt: out[stage]?.startedAt ?? now }
  return out
}

/** Ends the open stage, when the run finishes or fails. */
export function closeTimings(t: StageTimings | null | undefined, now: number): StageTimings {
  const out: StageTimings = { ...(t ?? {}) }
  const open = openStage(out)
  if (open) out[open] = { ...out[open]!, endedAt: now }
  return out
}

/** A fresh run: only the queue wait has started. analyzePaper and retryPaper write this. */
export function queuedTimings(now: number): StageTimings {
  return { queued: { startedAt: now } }
}

/** When the run started (the earliest stage start), or null for papers analyzed before timings existed. */
export function runStartedAt(t: StageTimings | null | undefined): number | null {
  if (!t) return null
  let first: number | null = null
  for (const s of TIMED_STAGES) {
    const at = t[s]?.startedAt
    if (typeof at === 'number' && (first === null || at < first)) first = at
  }
  return first
}

/** When the run ended (the latest stage end), or null while a stage is still open. */
export function runEndedAt(t: StageTimings | null | undefined): number | null {
  if (!t || openStage(t) || runStartedAt(t) === null) return null
  let last = 0
  for (const s of TIMED_STAGES) last = Math.max(last, t[s]?.endedAt ?? 0)
  return last || null
}

export interface TimingSummary {
  /** Milliseconds per stage; an open stage is measured up to `now`. */
  stages: Partial<Record<TimedStage, number>>
  /** From the first start to the last end (or `now` while running); null without timings. */
  totalMs: number | null
}

/** Durations for the elapsed display and for later quality evaluation of stored runs. */
export function stageDurations(t: StageTimings | null | undefined, now = Date.now()): TimingSummary {
  const stages: Partial<Record<TimedStage, number>> = {}
  const start = runStartedAt(t)
  if (!t || start === null) return { stages, totalMs: null }
  for (const s of TIMED_STAGES) {
    const span = t[s]
    if (!span) continue
    stages[s] = Math.max(0, (span.endedAt ?? now) - span.startedAt)
  }
  return { stages, totalMs: Math.max(0, (runEndedAt(t) ?? now) - start) }
}
