/**
 * A topic is known or not known: one checkbox. The check icon cross-fades in,
 * and aria-checked carries the state, so color is never the only cue.
 * Rows stored as "learning" from earlier versions read as not known.
 */

import { cn } from '@/lib/utils'
import type { KnowledgeStatus } from '../types'
import { CheckIcon } from './icons'

interface Props {
  status: KnowledgeStatus | null
  name: string
  disabled?: boolean
  onChange: (next: KnowledgeStatus | null) => void
  className?: string
}

export function KnownToggle({ status, name, disabled, onChange, className }: Props) {
  const known = status === 'known'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={known}
      aria-label={known ? `${name} is known. Mark as not known` : `Mark ${name} as known`}
      title={known ? 'Known' : 'Not known yet. Click to mark known'}
      disabled={disabled}
      onClick={() => onChange(known ? null : 'known')}
      data-testid="status-known"
      className={cn(
        'press relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-[3px] border-[1.5px] disabled:cursor-not-allowed disabled:opacity-50',
        known ? 'border-known bg-known text-known-foreground' : 'border-[color-mix(in_oklab,var(--color-foreground)_28%,transparent)] bg-card text-transparent dark:border-input',
        className,
      )}
    >
      <CheckIcon size={13} className="icon-swap" data-shown={known} />
    </button>
  )
}

/** The knowledge page's control: the same checkbox with its state on the wrapper for tests. */
export function StatusControl(props: Props) {
  return (
    <div className={cn('flex items-center', props.className)} data-testid="status-control" data-status={props.status === 'known' ? 'known' : 'unknown'}>
      <KnownToggle {...props} className={undefined} />
    </div>
  )
}
