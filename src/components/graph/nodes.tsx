/**
 * Node cards for the floating graphs: paper and branch nodes (buttons),
 * candidate paper nodes (dashed, with an Add action), and the center cards.
 */

import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Meter } from '../blueprint'
import { Button } from '../ui'
import { PlusIcon } from '../icons'

const nodeBase = 'press block w-full cursor-pointer select-none rounded border border-transparent bg-card px-3.5 py-3 text-left'
// Kept as separate whole strings so the ring and the resting shadow never compete in one class list.
const nodeResting = 'shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)]'
const nodeRinged = 'shadow-[0_0_0_2px_var(--color-primary),var(--shadow-ring-hi)]'
// A done branch gets the shared known outline (see .known-outline in styles.css).
const nodeDone = 'known-outline'

export const BranchNode = forwardRef<
  HTMLButtonElement,
  {
    name: string
    known: number
    total: number
    open?: boolean
    onOpen: () => void
    branchKey: string
    step?: number
    /** The branch holding the next concept to learn. */
    current?: 'start' | 'continue' | null
  }
>(function BranchNode({ name, known, total, open, onOpen, branchKey, step, current }, ref) {
  const done = total > 0 && known === total
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Open branch ${name}, ${known} of ${total} known`}
      data-testid="branch"
      data-branch-key={branchKey}
      data-step={step}
      data-current={current ? 'true' : undefined}
      data-done={done ? 'true' : undefined}
      className={cn(nodeBase, 'status-surface graph-w-branch', open || current ? nodeRinged : done ? nodeDone : nodeResting)}
    >
      {(step || current) && (
        <span className="mb-1 flex items-center justify-between gap-2">
          {step ? <span className="font-mono text-[11px] text-faint tabular-nums">Step {step}</span> : <span />}
          {current && <span className="label text-primary" data-testid="branch-current">{current === 'start' ? 'Start here' : 'Continue'}</span>}
        </span>
      )}
      <span className="mb-1.5 block text-sm font-semibold leading-snug">{name}</span>
      <span className="mb-1.5 flex items-center justify-between gap-2.5 text-xs text-muted-foreground tabular-nums">
        <span data-testid="branch-progress" data-known={known} data-total={total}>{known} of {total} known</span>
        {done && <span className="font-semibold text-known">Done</span>}
      </span>
      <Meter value={total ? known / total : 0} />
    </button>
  )
})

export function PaperNode({
  title,
  meta,
  known,
  total,
  finished,
  analyzing,
  failed,
  onOpen,
  arxivId,
  status,
}: {
  title: string
  meta: string
  known: number
  total: number
  finished: boolean
  analyzing?: string
  failed?: boolean
  onOpen: () => void
  arxivId: string
  status: 'active' | 'finished'
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${title}`}
      data-testid="workspace-paper"
      data-arxiv={arxivId}
      data-status={status}
      className={cn(nodeBase, nodeResting, 'graph-w-paper')}
    >
      <span className="label flex items-center justify-between gap-2">
        <span className="truncate">{meta}</span>
        {finished && <span className="text-known">Finished</span>}
      </span>
      <span className="mt-1 line-clamp-2 block text-sm font-semibold leading-snug" data-testid="workspace-paper-title">{title}</span>
      {analyzing ? (
        <span className="mt-2 block text-xs text-primary">{analyzing}</span>
      ) : failed ? (
        <span className="mt-2 block text-xs text-learning">Analysis failed. Open to retry.</span>
      ) : (
        <>
          <span className="mt-2 mb-1.5 block text-xs text-muted-foreground tabular-nums" data-testid="workspace-paper-progress">
            {known} of {total} known
          </span>
          <Meter value={total ? known / total : 0} />
        </>
      )}
    </button>
  )
}

export function CandidateNode({ title, reason, meta, busy, disabled, onAdd }: { title: string; reason: string; meta: string; busy?: boolean; disabled?: boolean; onAdd: () => void }) {
  return (
    <div
      className="graph-w-paper rounded border border-dashed border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-card)_85%,transparent)] px-3.5 py-3"
      data-testid="suggestion"
    >
      <span className="label block text-primary">Recommended</span>
      <span className="mt-1 line-clamp-2 block text-sm font-semibold leading-snug">{title}</span>
      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{meta}</span>
      <span className="mt-1.5 line-clamp-2 block text-xs text-muted-foreground" title={reason}>{reason}</span>
      <Button size="sm" variant="outline" className="mt-2" loading={busy} disabled={disabled} onClick={onAdd} data-testid="pick-suggestion">
        <PlusIcon size={13} /> Add
      </Button>
    </div>
  )
}

/**
 * The card at the center of a graph. With `onOpen`, a click anywhere on the
 * card that is not on one of its own controls calls it; the card's own button
 * for the same action stays the keyboard and screen-reader path.
 */
export function CenterCard({
  label,
  children,
  className,
  onOpen,
  testId,
}: {
  label: string
  children: ReactNode
  className?: string
  onOpen?: () => void
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      onClick={
        onOpen
          ? (e) => {
              if (!(e.target as HTMLElement).closest('button, a, input, label, select, textarea')) onOpen()
            }
          : undefined
      }
      className={cn(
        'graph-center w-[300px] max-w-[calc(100vw-48px)] rounded-lg border border-transparent bg-card px-5 py-[18px] shadow-[var(--shadow-ring-hi)]',
        onOpen && 'cursor-pointer',
        className,
      )}
    >
      <div className="label">{label}</div>
      {children}
    </div>
  )
}
