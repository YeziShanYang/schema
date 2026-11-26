/**
 * Where a paper is: one control for the paper page header, each Library row
 * and the constellation's selection panel. A button opens a popover with an
 * "In my Library" checkbox (save or unsave), one checkbox per workspace (a
 * paper can be in several), a New workspace field that creates the workspace
 * with the paper in it, and Remove from Library. Removing asks first, names
 * the workspaces the paper leaves and says the checkmarks stay. Unchecking
 * "In my Library" while the paper is in a workspace asks the same, because
 * the workspaces would keep it in the Library otherwise.
 *
 * With `mode="add"` (several papers, from the constellation) it only adds:
 * checking a workspace adds every paper to it, New workspace takes them all,
 * and every paper is also saved. A workspace that holds them all shows
 * checked and read-only.
 *
 * Checkboxes show the new state at once and hold it until the records agree
 * (or the write fails). While a write is in flight its checkbox is read-only,
 * which keeps focus on it. The popover closes on Esc and returns focus to its
 * button; the confirm returns focus there too.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Checkbox, Input, Modal, Popover, PopoverContent, PopoverTrigger, type ButtonProps } from '@/components/ui'
import { cn, plural } from '@/lib/utils'
import { coverage, placementLabel, removeText } from '../lib/membership'
import { useLibrary } from '../hooks/useLibrary'
import { useWorkspaces } from '../hooks/useWorkspaces'
import type { PaperRef } from '../hooks/useReader'
import { BookmarkIcon, ChevronDownIcon, FolderIcon, PlusIcon } from './icons'

const HOLD_MS = 10_000

interface Props {
  papers: readonly PaperRef[]
  mode?: 'place' | 'add'
  /** The workspace the page is in, listed first and named first on the button. */
  currentWorkspaceId?: string
  /** `label`: the button names where the paper is (paper page). `icon`: a small folder button (Library rows). */
  trigger?: 'label' | 'icon'
  size?: ButtonProps['size']
  className?: string
  testId?: string
}

export function PlacementControl({ papers, mode = 'place', currentWorkspaceId, trigger = 'label', size = 'sm', className, testId = 'placement-open' }: Props) {
  const library = useLibrary()
  const workspaces = useWorkspaces()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  // key ('library' or a workspace id) -> the state the reader asked for, until the records show it.
  const [pending, setPending] = useState<Map<string, boolean>>(() => new Map())
  const button = useRef<HTMLButtonElement>(null)
  const uid = useId()

  const single = papers.length === 1 ? papers[0] : null
  const entry = single ? library.byPaper.get(single.paperId) : undefined
  const member = !!entry
  const paperIds = useMemo(() => papers.map((p) => p.paperId), [papers])

  // Workspaces in the sidebar's order, the page's own first.
  const ordered = useMemo(() => {
    const rows = [...workspaces.rows]
    const i = rows.findIndex((w) => w.recordId === currentWorkspaceId)
    if (i > 0) rows.unshift(...rows.splice(i, 1))
    return rows
  }, [workspaces.rows, currentWorkspaceId])
  const { papersOf } = workspaces
  const holds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const w of ordered) m.set(w.recordId, new Set(papersOf(w.recordId).map((p) => p.paperId)))
    return m
  }, [ordered, papersOf])

  const actual = (key: string): boolean => {
    if (key === 'library') return member
    return coverage(holds.get(key) ?? new Set(), paperIds) === 'all'
  }
  const shown = (key: string) => (pending.has(key) ? pending.get(key)! : actual(key))

  // A confirmed write keeps its shown state until the records agree, or HOLD_MS at most.
  const actualRef = useRef(actual)
  actualRef.current = actual
  useEffect(() => {
    if (!pending.size) return
    const done = [...pending].filter(([k, v]) => actualRef.current(k) === v)
    if (done.length) {
      setPending((m) => {
        const n = new Map(m)
        for (const [k] of done) n.delete(k)
        return n
      })
    }
  }, [pending, library.entries, holds])
  const drop = (key: string) =>
    setPending((m) => {
      if (!m.has(key)) return m
      const n = new Map(m)
      n.delete(key)
      return n
    })

  const run = async (key: string, target: boolean, write: () => Promise<void>) => {
    if (pending.has(key)) return
    setError('')
    setNote('')
    setPending((m) => new Map(m).set(key, target))
    try {
      await write()
      setTimeout(() => drop(key), HOLD_MS)
    } catch (e) {
      drop(key)
      setError(e instanceof Error && e.message ? `That didn't save: ${e.message}` : "That didn't save. Try again.")
    }
  }

  const wsNames = (ids: readonly string[]) => ids.map((id) => workspaces.byId.get(id)?.data.name ?? 'a workspace')
  // On the paper page the route's workspace comes first.
  const entryWs = entry ? [...entry.data.workspaceIds].sort((a, b) => (a === currentWorkspaceId ? -1 : b === currentWorkspaceId ? 1 : 0)) : []

  const toggleLibrary = (next: boolean) => {
    if (!single) return
    if (!next && entry && entry.data.workspaceIds.length > 0) return askRemove()
    void run('library', next, () => (next ? library.save(single) : library.unsave(single)))
  }
  const toggleWorkspace = (wsId: string, next: boolean) => {
    if (mode === 'add') {
      if (!next) return
      void run(wsId, true, async () => {
        for (const p of papers) {
          await library.save(p)
          await library.addToWorkspace(wsId, p)
        }
        setNote(`Added ${papers.length === 1 ? 'the paper' : `${papers.length} papers`} to ${workspaces.byId.get(wsId)?.data.name ?? 'the workspace'}.`)
      })
      return
    }
    if (!single) return
    void run(wsId, next, () => (next ? library.addToWorkspace(wsId, single) : library.removeFromWorkspace(wsId, single.paperId)))
  }

  async function createWorkspace(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (mode === 'add') for (const p of papers) await library.save(p)
      const id = await library.createWorkspace(trimmed, '', papers)
      if (!id) throw new Error('')
      setName('')
      if (mode === 'add') setNote(`Created ${trimmed} with ${papers.length === 1 ? 'the paper' : `${papers.length} papers`}.`)
    } catch (err) {
      setError(err instanceof Error && err.message ? `Could not create the workspace: ${err.message}` : 'Could not create the workspace. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function askRemove() {
    setOpen(false)
    setConfirming(true)
  }
  async function confirmRemove() {
    if (!single) return
    setBusy(true)
    setError('')
    try {
      await library.removeFromLibrary(single)
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not remove the paper. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = mode === 'add' ? 'Add to workspace' : placementLabel(member, wsNames(entryWs))
  const title = single?.title || (single ? `arXiv ${single.arxivId}` : '')
  let triggerEl: ReactNode
  if (trigger === 'icon') {
    triggerEl = (
      <Button
        ref={button}
        size="icon"
        variant="ghost"
        className={cn('size-[30px] flex-none text-muted-foreground hover:text-foreground', className)}
        aria-label={`Edit workspaces for ${title}`}
        title="Edit workspaces"
        disabled={!library.ready}
        data-testid={testId}
      >
        <FolderIcon size={16} />
      </Button>
    )
  } else {
    triggerEl = (
      <Button
        ref={button}
        size={size}
        variant={mode === 'place' && member ? 'outline' : mode === 'add' ? 'outline' : 'default'}
        className={cn('max-w-[min(20rem,100%)]', className)}
        disabled={!library.ready}
        data-testid={testId}
        data-member={mode === 'place' ? (member ? 'true' : 'false') : undefined}
      >
        {mode === 'add' ? <PlusIcon size={14} /> : <BookmarkIcon size={14} className={cn(member && 'fill-current')} />}
        <span className="min-w-0 truncate">{library.ready ? label : 'Library'}</span>
        <ChevronDownIcon size={14} weight={2} className="flex-none" />
      </Button>
    )
  }

  const removeNames = wsNames(entryWs)

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setError('')
            setNote('')
          }
        }}
      >
        <PopoverTrigger render={triggerEl as React.ReactElement} />
        <PopoverContent
          align={trigger === 'icon' ? 'end' : 'start'}
          className="w-[min(20rem,calc(100vw-2rem))] p-1.5"
          aria-label={mode === 'add' ? `Add ${plural(papers.length, 'paper', 'papers')} to a workspace` : `Library and workspaces for ${title}`}
          data-testid="placement-popover"
          data-mode={mode}
        >
          {mode === 'place' ? (
            <CheckRow
              id={`${uid}-library`}
              label="In my Library"
              checked={shown('library')}
              pending={pending.has('library')}
              onChange={toggleLibrary}
              testId="placement-library"
            />
          ) : (
            <p className="px-2 pb-1 pt-1.5 text-[13px] text-muted-foreground">
              {papers.length === 1 ? 'The paper is' : `The ${papers.length} papers are`} saved in your Library and added to the workspace you check.
            </p>
          )}

          <div className={cn(mode === 'place' && 'mt-1.5 border-t border-border pt-1.5')}>
            <p className="label px-2 pb-1 pt-1" id={`${uid}-ws`}>Workspaces</p>
            {ordered.length === 0 ? (
              <p className="px-2 pb-1 text-[13px] text-muted-foreground">No workspaces yet.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto overscroll-contain" aria-labelledby={`${uid}-ws`}>
                {ordered.map((w) => {
                  const cov = coverage(holds.get(w.recordId) ?? new Set(), paperIds)
                  const checked = shown(w.recordId)
                  return (
                    <li key={w.recordId}>
                      <CheckRow
                        id={`${uid}-${w.recordId}`}
                        label={w.data.name}
                        checked={mode === 'add' && !checked && cov === 'some' ? 'indeterminate' : checked}
                        pending={pending.has(w.recordId)}
                        // Adding only: a workspace that already holds every paper can't be unchecked here.
                        readOnly={mode === 'add' && checked}
                        onChange={(next) => toggleWorkspace(w.recordId, next)}
                        testId="placement-workspace"
                        dataId={w.recordId}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            <form onSubmit={createWorkspace} className="flex gap-1.5 px-1 pb-1 pt-1.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New workspace"
                aria-label="New workspace name"
                maxLength={120}
                className="h-[30px] min-w-0 flex-1"
                data-testid="placement-new-name"
              />
              <Button type="submit" size="sm" variant="outline" loading={busy && !confirming} disabled={!name.trim()} data-testid="placement-new-create">
                Create
              </Button>
            </form>
          </div>

          {mode === 'place' && member && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={askRemove}
                className="press w-full cursor-pointer rounded-[3px] px-2 py-1.5 text-left text-sm text-destructive outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/70"
                data-testid="placement-remove"
              >
                Remove from Library…
              </button>
            </div>
          )}
          {note && <p role="status" className="px-2 pb-1 pt-1.5 text-[13px] text-known" data-testid="placement-note">{note}</p>}
          {error && <p role="alert" className="px-2 pb-1 pt-1.5 text-[13px] text-destructive" data-testid="placement-error">{error}</p>}
        </PopoverContent>
      </Popover>

      {mode === 'place' && single && (
        <Modal open={confirming} onClose={() => !busy && setConfirming(false)} size="sm" finalFocus={button}>
          <Modal.Header>
            <Modal.Title>Remove {title} from your Library?</Modal.Title>
            <Modal.Description>
              <span data-testid="placement-remove-text">{removeText(removeNames)}</span>
            </Modal.Description>
          </Modal.Header>
          {error && confirming && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Modal.Footer>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" loading={busy} onClick={() => void confirmRemove()} data-testid="placement-remove-confirm">
              Remove from Library
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  )
}

/** A checkbox with its label as one row, the whole row clickable. */
function CheckRow({
  id,
  label,
  checked,
  pending,
  readOnly,
  onChange,
  testId,
  dataId,
}: {
  id: string
  label: string
  checked: boolean | 'indeterminate'
  pending: boolean
  readOnly?: boolean
  onChange: (next: boolean) => void
  testId: string
  dataId?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[3px] px-2 py-1.5 hover:bg-accent" data-testid={testId} data-workspace-id={dataId} data-checked={checked === true}>
      <Checkbox
        id={id}
        checked={checked}
        readOnly={readOnly || pending}
        aria-busy={pending || undefined}
        onCheckedChange={(next) => !pending && !readOnly && onChange(next)}
      />
      <label htmlFor={id} className={cn('min-w-0 flex-1 cursor-pointer truncate text-sm', readOnly && 'cursor-default')} title={label}>
        {label}
      </label>
    </div>
  )
}
