/**
 * Three-state status for a topic: not known, learning, known.
 *
 * KnownToggle is the square that toggles known (the common action, with the
 * check icon cross-fading in). LearningToggle marks the topic as in
 * progress. StatusControl puts both side by side. Every state has a static
 * cue as well: the square's fill and icon, and the Learning toggle's pressed
 * state and color.
 */

import { cn } from '@/lib/utils'
import type { KnowledgeStatus } from '../types'
import { CheckIcon, DotIcon } from './icons'

interface Props {
  status: KnowledgeStatus | null
  name: string
  disabled?: boolean
  onChange: (next: KnowledgeStatus | null) => void
  className?: string
}

export function KnownToggle({ status, name, disabled, onChange, className }: Props) {
  const known = status === 'known'
  const learning = status === 'learning'
  return (
    <button
      type="button"
      aria-pressed={known}
      aria-label={known ? `${name} is known. Mark as not known` : `Mark ${name} as known`}
      title={known ? 'Known' : learning ? 'Learning. Click to mark known' : 'Not known yet. Click to mark known'}
      disabled={disabled}
      onClick={() => onChange(known ? null : 'known')}
      data-testid="status-known"
      className={cn(
        'press relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-[3px] border-[1.5px] disabled:cursor-not-allowed disabled:opacity-50',
        known
          ? 'border-known bg-known text-white'
          : learning
            ? 'border-learning bg-[color-mix(in_oklab,var(--color-learning)_12%,white)] text-learning'
            : 'border-[color-mix(in_oklab,var(--color-foreground)_28%,transparent)] bg-card text-transparent',
        className,
      )}
    >
      <span className="grid place-items-center [&>*]:[grid-area:1/1]">
        <CheckIcon size={13} className="icon-swap" data-shown={known} />
        <DotIcon size={12} className="icon-swap" data-shown={learning} />
      </span>
    </button>
  )
}

export function LearningToggle({ status, name, disabled, onChange, className }: Props) {
  const learning = status === 'learning'
  return (
    <button
      type="button"
      aria-pressed={learning}
      aria-label={learning ? `${name}: learning. Clear` : `Mark ${name} as learning`}
      disabled={disabled}
      onClick={() => onChange(learning ? null : 'learning')}
      data-testid="status-learning"
      className={cn(
        'press label inline-flex h-6 cursor-pointer items-center rounded-[3px] px-1.5 disabled:cursor-not-allowed disabled:opacity-50',
        learning
          ? 'bg-[color-mix(in_oklab,var(--color-learning)_14%,white)] text-learning'
          : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {learning ? 'Learning' : 'Mark learning'}
    </button>
  )
}

export function StatusControl(props: Props) {
  return (
    <div role="group" aria-label={`Status of ${props.name}`} className={cn('flex items-center gap-2', props.className)} data-testid="status-control" data-status={props.status ?? 'unknown'}>
      <KnownToggle {...props} className={undefined} />
      <LearningToggle {...props} className={undefined} />
    </div>
  )
}
