/**
 * The analysis progress view. The paper window shows it instead of the
 * branch graph while a paper is queued, being analyzed or failed, and for a
 * moment after the paper turns ready. Everything on it comes from the paper
 * record and its concept records as they sync:
 *
 * - An arXiv-style sheet carries the paper's title. Its ambient motion
 *   follows `stage`: a scan line while the paper is read, highlights while
 *   concepts are found, pencil notes in the margin while the overview and
 *   the walkthrough are written, and the scan line again while the overview
 *   is checked against the paper.
 * - The checklist beside it marks each stage done, active or waiting from
 *   `stage`, with the job's `progressMessage` under the active stage and
 *   times from `timings`.
 * - A branch joins the graph when its first concept record arrives, one
 *   node at a time, with a running concept count.
 * - A failed run shows the error and Retry. A run with no update for 20
 *   minutes offers Retry too.
 *
 * When the paper turns ready, the finished checklist stays for HOLD_MS. Then
 * the paper window mounts underneath and plays its entrance while this view
 * fades out over it in FADE_MS.
 * Under reduced motion the sheet is static and things appear by fade only.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { RecordData } from 'deepspace'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { PaperData, PaperStatus, TimedStage } from '../../types'
import type { BranchProgress } from '../../lib/branches'
import { lastStartedStage, runStartedAt, stageDurations } from '../../lib/timings'
import { useRetryPaper, usePaperSlot } from '../../hooks/useRetryPaper'
import { ANALYSIS_TIME } from '../../constants'
import { FloatingGraph } from '../graph/FloatingGraph'
import { CheckIcon } from '../icons'
import './analysis-progress.css'

/** Matches retryPaper: a run with no update for this long can be restarted. */
const STUCK_AFTER_MS = 20 * 60 * 1000
/** The end of the usual time (ANALYSIS_TIME); past this the view says it is taking longer. */
const USUAL_MAX_MS = 2 * 60 * 1000
/** How long the finished checklist stays before the view fades. */
const HOLD_MS = 600
/** The cross-fade into the paper window, an exit at 150ms. Matches the transition in analysis-progress.css. */
const FADE_MS = 150
/** Spacing between branch nodes joining the graph. */
const REVEAL_MS = 450

type JobStage = Exclude<TimedStage, 'queued'>
type StageState = 'done' | 'active' | 'waiting' | 'failed'

/**
 * The five stages in order. `quiet` lists job messages that only restate the
 * label, so they are not shown under it ("Converting the PDF to text" shows:
 * it means the paper has no HTML version).
 */
const STAGES: { key: JobStage; label: string; quiet: string[] }[] = [
  { key: 'text', label: 'Reading the paper', quiet: ['Preparing', 'Reading the paper'] },
  { key: 'concepts', label: 'Finding concepts', quiet: ['Finding the concepts this paper relies on'] },
  { key: 'overview', label: 'Writing the overview', quiet: ['Writing a plain-language overview'] },
  { key: 'explain', label: 'Writing the walkthrough', quiet: ['Writing the section walkthrough and check questions', 'Writing the section walkthrough'] },
  { key: 'verify', label: 'Checking the overview', quiet: ['Checking the overview against the paper'] },
]
const STAGE_KEYS = STAGES.map((s) => s.key)
const STATE_WORDS: Record<StageState, string> = { done: 'done', active: 'in progress', waiting: 'waiting', failed: 'failed' }

// ---------------------------------------------------------------------------
// Phase: whether the paper window shows this view
// ---------------------------------------------------------------------------

/**
 * `on` while the paper is not ready, then `hold` (the finished checklist)
 * and `fade` (the paper window mounts and enters underneath while this view
 * fades), then `off`. A paper that is ready when it first loads is `off`
 * from the start. The paper window shows its graph from `fade` on.
 */
export type AnalysisPhase = 'off' | 'on' | 'hold' | 'fade'

export function useAnalysisPhase(paperId: string | undefined, status: PaperStatus | undefined): AnalysisPhase {
  const running = status !== undefined && status !== 'ready'
  const [s, setS] = useState<{ id: string | undefined; phase: AnalysisPhase }>({ id: paperId, phase: running ? 'on' : 'off' })
  // Adjusted during render, so no frame shows the paper window before the
  // view (or the view for a different paper after navigating).
  if (s.id !== paperId) setS({ id: paperId, phase: running ? 'on' : 'off' })
  else if (running && s.phase !== 'on') setS({ id: paperId, phase: 'on' })
  else if (!running && s.phase === 'on') setS({ id: paperId, phase: status === 'ready' ? 'hold' : 'off' })

  useEffect(() => {
    if (s.phase !== 'hold' && s.phase !== 'fade') return
    const next: AnalysisPhase = s.phase === 'hold' ? 'fade' : 'off'
    const t = setTimeout(() => setS((cur) => (cur.phase === s.phase ? { ...cur, phase: next } : cur)), s.phase === 'hold' ? HOLD_MS : FADE_MS)
    return () => clearTimeout(t)
  }, [s.phase])
  return s.phase
}

// ---------------------------------------------------------------------------
// Small hooks and helpers
// ---------------------------------------------------------------------------

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** The current time, refreshed every `every` ms while `active`. */
function useNow(active: boolean, every: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [active, every])
  return now
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** The stage a failed run stopped in: from its timings, or for older records from the last progress value. */
function failedStage(d: PaperData): JobStage | null {
  const last = lastStartedStage(d.timings)
  if (last) return last === 'queued' ? null : last
  const p = d.progress ?? 0
  if (p <= 0) return null
  return p < 0.2 ? 'text' : p < 0.55 ? 'concepts' : p < 0.7 ? 'overview' : p < 0.85 ? 'explain' : 'verify'
}

function stageStates(d: PaperData): StageState[] {
  if (d.status === 'ready') return STAGE_KEYS.map(() => 'done')
  const at = d.status === 'failed' ? failedStage(d) : (d.stage as JobStage)
  const idx = at ? STAGE_KEYS.indexOf(at) : -1
  const here: StageState = d.status === 'failed' ? 'failed' : 'active'
  // While verify has the overview rewritten, the walkthrough stays done; verify itself runs again.
  const ran = (key: JobStage) => key !== 'verify' && !!d.timings?.[key]?.endedAt
  return STAGE_KEYS.map((key, i) => (idx < 0 ? 'waiting' : i === idx ? here : i < idx || ran(key) ? 'done' : 'waiting'))
}

/**
 * Keys that have joined the graph, in the order they joined. New keys join
 * REVEAL_MS apart; under reduced motion they all join at once. Keys already
 * present when the view mounts (a reload mid-run) join together.
 */
function useReveal(keys: string[], reduced: boolean): Set<string> {
  const [shown, setShown] = useState<string[]>(keys)
  const sig = keys.join('|')
  const shownSig = shown.join('|')
  useEffect(() => {
    const live = new Set(keys)
    if (shown.some((k) => !live.has(k))) {
      setShown((s) => s.filter((k) => live.has(k)))
      return
    }
    const pending = keys.filter((k) => !shown.includes(k))
    if (!pending.length) return
    if (reduced) {
      setShown((s) => [...s, ...pending])
      return
    }
    const t = setTimeout(() => setShown((s) => (s.includes(pending[0]) ? s : [...s, pending[0]])), shown.length ? REVEAL_MS : 0)
    return () => clearTimeout(t)
    // keys and shown are compared through their signatures.
  }, [sig, shownSig, reduced])
  return new Set(shown)
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function AnalysisProgress({
  phase,
  paper,
  branches,
  order,
  signedIn,
  onSignIn,
}: {
  phase: AnalysisPhase
  paper: RecordData<PaperData>
  /** Branch rows with their concept counts so far (usePaper().branches). */
  branches: BranchProgress[]
  /** Branch keys in the recommended order, so nodes sit where the paper window puts them. */
  order: string[]
  signedIn: boolean
  onSignIn: (trigger: HTMLElement) => void
}) {
  const d = paper.data
  const reduced = usePrefersReducedMotion()
  const leaving = phase === 'hold' || phase === 'fade'
  const failed = d.status === 'failed'
  const ready = d.status === 'ready'
  const running = !failed && !ready
  const minute = useNow(running, 30_000)
  const stuck = running && minute - (Date.parse(paper.updatedAt) || minute) > STUCK_AFTER_MS

  const { retry, retrying, error: retryError } = useRetryPaper(paper.recordId)
  const slot = usePaperSlot(paper.recordId, d.status, signedIn)

  // While in the page flow, remember the view's box (after every render and
  // resize); when it starts leaving it keeps that box, absolutely positioned,
  // so the strip and the paper window can appear underneath without moving it.
  const rootRef = useRef<HTMLElement>(null)
  const box = useRef<{ top: number; left: number; width: number; height: number } | null>(null)
  const measure = () => {
    const el = rootRef.current
    if (el) box.current = { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight }
  }
  useLayoutEffect(() => {
    if (!leaving) measure()
  })
  useEffect(() => {
    const el = rootRef.current
    if (!el || leaving) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [leaving])
  const leaveStyle: CSSProperties | undefined =
    leaving && box.current ? { position: 'absolute', zIndex: 20, ...box.current } : undefined

  const states = stageStates(d)
  const activeIdx = states.indexOf('active')
  const reached = ready ? STAGES.length : failed ? Math.max(-1, states.indexOf('failed') - 1) : activeIdx
  const note = (() => {
    const m = (d.progressMessage ?? '').trim()
    if (!running || !m) return ''
    if (activeIdx >= 0 && STAGES[activeIdx].quiet.includes(m)) return ''
    return m
  })()
  const noteIdx = activeIdx >= 0 ? activeIdx : 0

  // A branch joins once its first concept record arrives. While a run is still
  // before that point, concepts left from an earlier failed run are not shown.
  const eligible = branches.filter((b) => b.total > 0 && (!running || activeIdx >= STAGE_KEYS.indexOf('overview')))
  const conceptsFound = eligible.reduce((n, b) => n + b.total, 0)
  // Checked every 30 seconds: past the usual time, the view says so.
  const startedAt = runStartedAt(d.timings)
  const slow = running && startedAt !== null && minute - startedAt > USUAL_MAX_MS
  const shown = useReveal(eligible.map((b) => b.key), reduced)
  const rank = new Map(order.map((k, i) => [k, i]))
  const nodes = eligible
    .filter((b) => shown.has(b.key))
    .sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99))
    .map((b) => ({ key: b.key, content: <ProgressNode branch={b} running={running} /> }))

  const announcement = ready
    ? 'Analysis finished'
    : failed
      ? `Analysis failed: ${d.error || 'unknown error'}`
      : activeIdx >= 0
        ? `${STAGES[activeIdx].label}${note ? `. ${note}` : ''}`
        : note || 'Waiting to start'

  const retryControls = signedIn ? (
    <>
      <p className="mt-1 text-xs text-muted-foreground">Anyone signed in can retry. A retry uses one of your new papers for today.</p>
      <Button className="mt-2" size="sm" onClick={retry} loading={retrying}>Retry</Button>
    </>
  ) : (
    <p className="mt-1 text-xs text-muted-foreground">
      <button type="button" className="cursor-pointer text-primary hover:underline" onClick={(e) => onSignIn(e.currentTarget)}>Sign in</button> to retry it.
    </p>
  )

  const card = (
    <div
      className="graph-center w-[440px] max-w-[calc(100vw-48px)] rounded-lg border border-transparent bg-card px-5 py-[18px] shadow-[var(--shadow-ring-hi)]"
      data-testid="paper-progress"
    >
      <div className="label">{ready ? 'Analysis done' : failed ? 'Analysis stopped' : 'Analyzing this paper'}</div>
      <div className="mt-3 flex items-start gap-4 sm:gap-5">
        <PaperSheet title={d.title} reached={reached} moving={running} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch pt-0.5">
          <ol aria-label="Analysis stages" className="grid gap-2.5">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                data-testid="progress-stage"
                data-stage-key={s.key}
                data-state={states[i]}
                className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5"
              >
                <StageMark state={states[i]} />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'text-[13px] leading-[18px] text-pretty',
                        states[i] === 'waiting' ? 'text-muted-foreground' : 'text-foreground',
                        (states[i] === 'active' || states[i] === 'failed') && 'font-medium',
                      )}
                    >
                      {s.label}
                      <span className="sr-only">, {STATE_WORDS[states[i]]}</span>
                    </span>
                    <StageTime paper={d} stage={s.key} state={states[i]} />
                  </div>
                  {note && i === noteIdx && (
                    <p className="mt-0.5 text-xs text-muted-foreground text-pretty" data-testid="progress-note">{note}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {conceptsFound > 0 && (
            <p className="mt-auto text-xs text-muted-foreground tabular-nums" data-testid="progress-found">
              {conceptsFound} {conceptsFound === 1 ? 'concept' : 'concepts'} in {eligible.length} {eligible.length === 1 ? 'branch' : 'branches'}
              {running && ' so far'}
            </p>
          )}
        </div>
      </div>

      {failed ? (
        <div className="mt-3.5 border-t border-border pt-2.5" data-testid="paper-failed">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-[13px] text-pretty">Analysis failed: {d.error || 'unknown error'}</p>
            <TotalTime paper={d} running={false} prefix="Stopped after" />
          </div>
          {slot === 'counted' || slot === 'refunded' ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="paper-failed-slot" data-slot={slot}>
              {slot === 'counted'
                ? 'It failed after a paid step, so your request used one of your new papers for today.'
                : 'It failed before any paid step, so your new paper for today was given back.'}
            </p>
          ) : null}
          {retryControls}
          {retryError && <p className="mt-1 text-xs text-destructive">{retryError}</p>}
        </div>
      ) : (
        <p className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-border pt-2.5 text-[12.5px] text-muted-foreground">
          <span>{ready ? 'Done' : slow ? 'Taking longer than usual. Long papers can take a few minutes.' : `Usually ${ANALYSIS_TIME}`}</span>
          <TotalTime paper={d} running={running} prefix={ready ? 'Took' : 'Elapsed'} />
        </p>
      )}

      {running && stuck && (
        <div className="mt-3" data-testid="paper-stuck">
          <p className="text-[13px]">No progress for over 20 minutes.</p>
          {retryControls}
          {retryError && <p className="mt-1 text-xs text-destructive">{retryError}</p>}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  )

  return (
    <section
      ref={rootRef}
      aria-label="Analysis progress"
      data-testid="analysis-progress"
      data-phase={phase}
      data-stage={d.stage}
      className="analysis-progress flex flex-1 flex-col bg-background"
      style={leaveStyle}
      inert={phase === 'fade' || undefined}
    >
      <FloatingGraph
        label={`Branches found so far in ${d.title}`}
        testId="progress-graph"
        className="min-h-[560px] flex-1"
        center={card}
        nodes={nodes}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function ProgressNode({ branch, running }: { branch: BranchProgress; running: boolean }) {
  return (
    <div
      className="graph-w-branch block w-full select-none rounded border border-transparent bg-card px-3.5 py-3 text-left shadow-[var(--shadow-ring)]"
      data-testid="progress-branch"
      data-branch-key={branch.key}
      data-count={branch.total}
    >
      <span className="mb-1 block text-sm font-semibold leading-snug">{branch.name}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">
        {branch.total} {branch.total === 1 ? 'concept' : 'concepts'}
        {running && ' so far'}
      </span>
    </div>
  )
}

/** Done, active, waiting or failed. All four marks stay mounted and cross-fade (icon-swap). */
function StageMark({ state }: { state: StageState }) {
  return (
    <span className="relative mt-px size-4" aria-hidden="true">
      <span
        className="icon-swap absolute inset-px rounded-full border-[1.5px] border-[color-mix(in_oklab,var(--color-foreground)_24%,transparent)]"
        data-shown={state === 'waiting'}
      />
      <span className="icon-swap absolute inset-0 grid place-items-center" data-shown={state === 'active'}>
        <span className="stage-dot relative size-2 rounded-full bg-primary" />
      </span>
      <span className="icon-swap absolute inset-0 grid place-items-center rounded-full bg-known text-known-foreground" data-shown={state === 'done'}>
        <CheckIcon size={10} weight={1.75} />
      </span>
      <span className="icon-swap absolute inset-0 grid place-items-center rounded-full bg-destructive text-destructive-foreground" data-shown={state === 'failed'}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
        </svg>
      </span>
    </span>
  )
}

/** A done stage shows how long it took; the active one counts up. */
function StageTime({ paper, stage, state }: { paper: PaperData; stage: JobStage; state: StageState }) {
  const active = state === 'active'
  const now = useNow(active, 1000)
  const span = paper.timings?.[stage]
  if (!span || state === 'waiting') return null
  const ms = (span.endedAt ?? (active ? now : 0)) - span.startedAt
  if (!span.endedAt && !active) return null
  return (
    <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums" data-testid="progress-stage-time">
      {formatDuration(ms)}
    </span>
  )
}

/** The run's total time: counting up while it runs, fixed once it ended. */
function TotalTime({ paper, running, prefix }: { paper: PaperData; running: boolean; prefix: string }) {
  const now = useNow(running, 1000)
  const { totalMs } = stageDurations(paper.timings, now)
  if (totalMs === null) return null
  return (
    <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums" data-testid="progress-elapsed" data-ms={totalMs}>
      {prefix} <span className="font-mono text-[12px] text-foreground">{formatDuration(totalMs)}</span>
    </span>
  )
}

// Bars on the sheet, in px of the 144 by 186 sheet. `mark` is the highlight
// order during concept finding; null is a paragraph break.
type Line = { w: number; mark?: number } | null
const ABSTRACT: Line[] = [{ w: 1 }, { w: 1, mark: 0 }, { w: 0.72 }]
const COLUMN_A: Line[] = [
  { w: 1 }, { w: 1 }, { w: 0.96, mark: 1 }, { w: 1 }, { w: 1 }, { w: 0.58 }, null,
  { w: 1 }, { w: 1 }, { w: 0.93 }, { w: 1 }, { w: 1, mark: 3 }, { w: 1 }, { w: 0.7 }, null,
  { w: 1 }, { w: 0.98 }, { w: 1 },
]
const COLUMN_B: Line[] = [
  { w: 1 }, { w: 0.97 }, { w: 1 }, { w: 1 }, { w: 0.66 }, null,
  { w: 1 }, { w: 1, mark: 2 }, { w: 1 }, { w: 0.92 }, { w: 1 }, { w: 0.48 }, null,
  { w: 1 }, { w: 1 }, { w: 1, mark: 4 }, { w: 0.95 }, { w: 0.6 },
]

function Bars({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((l, i) =>
        l ? (
          <i
            key={i}
            className="sheet-bar"
            data-mark={l.mark ?? undefined}
            style={{ width: `${l.w * 100}%`, ['--m' as string]: l.mark ?? 0 }}
          />
        ) : (
          <i key={i} className="sheet-gap" />
        ),
      )}
    </>
  )
}

/**
 * The arXiv-style sheet. `reached` is the index of the stage it shows (-1
 * before the job starts, 5 when done); `moving` loops that stage's motion.
 * Earlier stages' marks stay on the sheet, still. Checking the overview
 * (stage 4) loops the scan line again.
 */
function PaperSheet({ title, reached, moving }: { title: string; reached: number; moving: boolean }) {
  const layer = (stage: number) => (reached === stage && moving ? 'loop' : reached >= stage ? 'still' : 'none')
  const scan = reached === 4 && moving ? 'loop' : layer(0)
  return (
    <div className="sheet-frame shrink-0" aria-hidden="true">
      <div
        className="paper-sheet"
        data-testid="paper-sheet"
        data-scan={scan}
        data-marks={layer(1)}
        data-notes-a={layer(2)}
        data-notes-b={layer(3)}
      >
        <p className="sheet-title">{title}</p>
        <i className="sheet-bar sheet-author" />
        <div className="sheet-abstract">
          <Bars lines={ABSTRACT} />
        </div>
        <div className="sheet-cols">
          <div>
            <Bars lines={COLUMN_A} />
          </div>
          <div>
            <Bars lines={COLUMN_B} />
          </div>
        </div>
        <svg className="sheet-notes" viewBox="0 0 144 186" fill="none">
          {/* While the overview is written: a bracket by the abstract and a tick in the right margin. */}
          <path className="note-a" style={{ ['--n' as string]: 0 }} pathLength={1} d="M8 46q-3 0-3 3v8q0 3 3 3" />
          <path className="note-a" style={{ ['--n' as string]: 1 }} pathLength={1} d="M134.5 105.5l2 2.5 4.5-5.5" />
          {/* While the walkthrough is written: a question mark and a squiggle. */}
          <path className="note-b" style={{ ['--n' as string]: 0 }} pathLength={1} d="M135.5 145.5q0-3.2 3-3.2t3 2.9q0 1.9-3 3.1v1.4M138.5 152.9v.2" />
          <path className="note-b" style={{ ['--n' as string]: 1 }} pathLength={1} d="M5.5 122.5q-1.6 2.2 0 4.4t0 4.4 0 4.4" />
        </svg>
        <span className="sheet-scan" />
      </div>
    </div>
  )
}
