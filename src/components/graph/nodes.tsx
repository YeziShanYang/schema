/**
 * Node cards for the floating graphs: paper and branch nodes (buttons),
 * candidate paper nodes (dashed, with Add and dismiss actions), and the
 * center cards. The dismiss button is shared with the workspace list view.
 */

import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Meter } from '../blueprint'
import { Button } from '../ui'
import { CloseIcon, PlusIcon } from '../icons'

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

export function CandidateNode({
  arxivId,
  title,
  reason,
  meta,
  busy,
  disabled,
  dismissDisabled,
  onAdd,
  onDismiss,
}: {
  arxivId: string
  title: string
  reason: string
  meta: string
  busy?: boolean
  disabled?: boolean
  dismissDisabled?: boolean
  onAdd: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className="graph-w-paper rounded border border-dashed border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-card)_85%,transparent)] px-3.5 py-3"
      data-testid="suggestion"
      data-arxiv={arxivId}
    >
      {/* The negative margins keep the 30px button from making the label row taller. */}
      <span className="flex items-center justify-between gap-2">
        <span className="label block text-primary">Recommended</span>
        <DismissSuggestionButton title={title} disabled={dismissDisabled} onDismiss={onDismiss} className="-my-[7px] -mr-2" />
      </span>
      <span className="mt-1 line-clamp-2 block text-sm font-semibold leading-snug" data-testid="suggestion-title">{title}</span>
      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{meta}</span>
      <span className="mt-1.5 line-clamp-2 text-xs text-muted-foreground" title={reason}>{reason}</span>
      <Button size="sm" variant="outline" className="mt-2" loading={busy} disabled={disabled} onClick={onAdd} data-testid="pick-suggestion">
        <PlusIcon size={13} /> Add
      </Button>
    </div>
  )
}

/** Removes a recommendation from the workspace. Used by the graph's candidate cards and the list view's rows. */
export function DismissSuggestionButton({ title, disabled, onDismiss, className }: { title: string; disabled?: boolean; onDismiss: () => void; className?: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn('flex-none text-muted-foreground hover:text-foreground', className)}
      aria-label={`Dismiss recommendation ${title}`}
      title="Dismiss"
      disabled={disabled}
      onClick={onDismiss}
      data-testid="dismiss-suggestion"
    >
      <CloseIcon size={16} />
    </Button>
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
              // React events bubble out of portals, so a click in a dialog opened from the card (Read again) is ignored.
              const target = e.target as HTMLElement
              if (e.currentTarget.contains(target) && !target.closest('button, a, input, label, select, textarea')) onOpen()
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
