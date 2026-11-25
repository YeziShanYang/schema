/**
 * The recommended-sequence strip on the paper window: step 0 "Overview" (when
 * the paper has one) and then the branches in order, joined by arrows, with
 * the primary "Next up" action beside them. Every step is one 34px row. Steps
 * never wrap: when they overflow, the row scrolls sideways behind a fade mask
 * while the action stays pinned on the right. Below 640px the action takes
 * its own row under the steps.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { SequenceStep, StepState } from '../../lib/sequence'
import { ArrowRightIcon, CheckIcon } from '../icons'

function Step({
  index,
  name,
  state,
  count,
  onClick,
  testId,
  branchKey,
}: {
  index: number
  name: string
  state: StepState
  count?: string
  onClick: (el: HTMLElement) => void
  testId: string
  branchKey?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.currentTarget)}
      data-testid={testId}
      data-state={state}
      data-branch-key={branchKey}
      aria-current={state === 'current' ? 'step' : undefined}
      className={cn(
        'press inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded border px-2.5 py-1.5 text-[13px] leading-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        state === 'current' ? 'border-primary bg-accent-soft text-primary' : 'border-transparent hover:bg-accent',
        state === 'done' ? 'text-muted-foreground' : state === 'upcoming' && 'text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] leading-none tabular-nums',
          state === 'done'
            ? 'bg-known text-white'
            : state === 'current'
              ? 'bg-primary text-primary-foreground'
              : 'border border-[color-mix(in_oklab,var(--color-foreground)_24%,transparent)] text-muted-foreground',
        )}
      >
        {state === 'done' ? <CheckIcon size={12} /> : <span className="translate-y-[0.5px]">{index}</span>}
      </span>
      <span>
        <span className="sr-only">Step {index}: </span>
        {name}
        {state === 'done' && <span className="sr-only"> (done)</span>}
      </span>
      {count && <span className="text-xs leading-5 text-muted-foreground tabular-nums">{count}</span>}
    </button>
  )
}

function Arrow() {
  return (
    <span aria-hidden="true" className="mx-2 flex h-[34px] items-center text-faint">
      <ArrowRightIcon size={14} />
    </span>
  )
}

export function SequenceStrip({
  steps,
  overview,
  onOpenBranch,
  onOpenOverview,
  action,
}: {
  steps: SequenceStep[]
  /** Step 0, shown when the paper has an overview. */
  overview: { state: StepState } | null
  onOpenBranch: (branchKey: string) => void
  onOpenOverview: (trigger: HTMLElement) => void
  action: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  // Fade whichever edge has more steps behind it.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      const left = el.scrollLeft > 1
      const right = el.scrollLeft < max - 1
      setFade((f) => (f.left === left && f.right === right ? f : { left, right }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  // Keep the current step in view without scrolling the page.
  const current = overview?.state === 'current' ? 'overview' : steps.find((s) => s.state === 'current')?.branchKey ?? ''
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !current) return
    const step = el.querySelector<HTMLElement>('[aria-current="step"]')
    if (!step) return
    const box = el.getBoundingClientRect()
    const r = step.getBoundingClientRect()
    if (r.left < box.left || r.right > box.right) el.scrollLeft += r.left - box.left - 24
  }, [current])

  return (
    <section
      className="flex flex-col gap-2 border-b border-border bg-surface-2 px-5 py-2 min-[640px]:flex-row min-[640px]:items-center min-[640px]:gap-4 md:px-7"
      aria-label="Recommended sequence"
      data-testid="sequence-strip"
    >
      <div
        ref={scrollRef}
        // `relative` makes this the containing block of the steps' sr-only labels (position: absolute), which
        // otherwise sit against the page and widen it by the strip's whole scroll width.
        className="strip-scroll relative -mx-1 min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 py-1"
        data-fade-left={fade.left || undefined}
        data-fade-right={fade.right || undefined}
        data-testid="sequence-scroll"
      >
        <ol className="flex w-max items-center">
          {overview && (
            <li className="flex items-center">
              <Step index={0} name="Overview" state={overview.state} onClick={onOpenOverview} testId="sequence-overview" />
            </li>
          )}
          {steps.map((s, i) => (
            <li key={s.branchKey} className="flex items-center">
              {(i > 0 || overview) && <Arrow />}
              <Step
                index={s.index}
                name={s.name}
                state={s.state}
                count={s.state !== 'done' && s.known > 0 ? `${s.known} of ${s.total}` : undefined}
                onClick={() => onOpenBranch(s.branchKey)}
                testId="sequence-step"
                branchKey={s.branchKey}
              />
            </li>
          ))}
        </ol>
      </div>
      {action && <div className="flex min-w-0 shrink-0 items-center" data-testid="sequence-action">{action}</div>}
    </section>
  )
}
