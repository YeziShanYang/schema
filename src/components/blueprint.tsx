/**
 * Small Blueprint building blocks shared by pages: page header, meter, chip,
 * segmented control and an inline-editable text field.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A page's title bar. The highlighted sidebar row already names the page, so there is no eyebrow label. */
export function PageHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-5 pb-3.5 pt-5 md:px-7', className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] text-balance">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  )
}

export function Meter({ value, className, tone = 'known' }: { value: number; className?: string; tone?: 'known' | 'primary' }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
  return (
    <span
      role="presentation"
      className={cn('block h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-foreground)_8%,transparent)]', className)}
    >
      <i className={cn('meter-fill block h-full rounded-[inherit]', tone === 'known' ? 'bg-known' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </span>
  )
}

export function Chip({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'accent' | 'known' | 'learning'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-[3px] border border-transparent px-[7px] py-px font-mono text-[11px] uppercase tracking-[0.05em]',
        tone === 'plain' && 'border-border bg-surface-2 text-muted-foreground',
        tone === 'accent' && 'bg-accent-soft text-primary',
        tone === 'known' && 'bg-[color-mix(in_oklab,var(--color-known)_12%,var(--color-card))] text-known',
        tone === 'learning' && 'bg-[color-mix(in_oklab,var(--color-learning)_12%,var(--color-card))] text-learning',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A Blueprint segmented control: one pressed button per option. */
export function Segmented<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  testId,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (next: T) => void
  testId?: string
}) {
  return (
    <div className="flex w-fit gap-1 rounded-[7px] border border-border bg-surface-2 p-[3px]" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn('press cursor-pointer rounded-[3px] border border-transparent px-3 py-1 text-sm font-medium', value === o ? 'border-transparent bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  )
}

/** Text that turns into an input on click; saves on Enter or blur, cancels on Escape. */
export function InlineEdit({
  value,
  onSave,
  label,
  placeholder,
  multiline,
  className,
}: {
  value: string
  onSave: (next: string) => void | Promise<void>
  label: string
  placeholder?: string
  multiline?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const commit = async () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value) await onSave(next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
        className={cn('cursor-text rounded text-left hover:bg-[color-mix(in_oklab,var(--color-foreground)_4%,transparent)]', !value && 'text-faint', className)}
      >
        {value || placeholder}
      </button>
    )
  }
  const shared = {
    ref,
    value: draft,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(value)
        setEditing(false)
      } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault()
        void commit()
      }
    },
    className: cn('w-full rounded border border-input bg-card px-1.5 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring', className),
  }
  return multiline ? <textarea rows={2} {...shared} /> : <input {...shared} />
}
