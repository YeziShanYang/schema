/**
 * The one Add flow: a centered window with two paths.
 *
 * Paper: paste a link, look it up on arXiv (peekPaper, free), then choose
 * where it goes: an existing workspace (the one opened last is preselected),
 * a new workspace with a suggested name, or, for a paper that already exists
 * and so costs nothing, no workspace at all. Then open its paper window. A
 * paper already in the chosen workspace says so and simply opens there. A
 * new workspace is created on the server only after the paper checks out.
 * Home's paper box opens this path with its look-up already done (`initial`).
 *
 * Opening without a workspace does not save the paper in the Library.
 *
 * Workspace: name, optional description and, optionally, papers from the
 * reader's Library (a searchable checklist), then open it. The workspace page
 * asks for recommendations once: starter papers for an empty workspace, and
 * `next` picks that follow on from the papers when some were added.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn, plural } from '@/lib/utils'
import { Button, Checkbox, Input, SearchInput, Textarea } from './ui'
import { BranchPanel } from './graph/BranchPanel'
import { BookIcon, LinkIcon, PlusIcon } from './icons'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useLibrary, type LibraryEntry } from '../hooks/useLibrary'
import { useAllowance } from '../hooks/useAllowance'
import { actions, type PaperPeek } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'
import { formatSlotTime } from '../lib/cap'
import { ANALYSIS_TIME } from '../constants'

type Step = 'choose' | 'paper' | 'workspace'
type Dest = 'new' | 'existing' | 'none'

/** What the workspace page asks recommendPapers for when it first opens (router state from this window). */
export type FirstRecommendation = 'starter' | 'next'

/** Library entries whose title or arXiv id contains every word of `query`, ignoring case. */
function matchEntries(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries.filter((e) => {
    const text = `${e.data.title} ${e.data.arxivId}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

export function AddDialog({
  open,
  onClose,
  workspaceId,
  initial,
  returnFocus,
}: {
  open: boolean
  onClose: () => void
  workspaceId?: string
  /** Where focus goes when the window closes. */
  returnFocus?: () => HTMLElement | null
  /** A look-up already done elsewhere (Home's paper box): the window opens on the paper path with it. */
  initial?: { input: string; peek: PaperPeek }
}) {
  const navigate = useNavigate()
  const workspaces = useWorkspaces()
  const library = useLibrary()
  const { allowance } = useAllowance()
  const [step, setStep] = useState<Step>(workspaceId ? 'paper' : 'choose')
  const [input, setInput] = useState('')
  const [peek, setPeek] = useState<PaperPeek | null>(null)
  const [dest, setDest] = useState<Dest>(workspaceId ? 'existing' : 'new')
  const [name, setName] = useState('')
  const [wsId, setWsId] = useState(workspaceId ?? '')
  const [wsName, setWsName] = useState('')
  const [wsDescription, setWsDescription] = useState('')
  // Library papers checked for the new workspace, by paper id, and the checklist's search.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [pickQuery, setPickQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Once the reader picks a destination, a late workspace load no longer changes it.
  const destPicked = useRef(false)
  const rows = useRef(workspaces.rows)
  rows.current = workspaces.rows

  // Start fresh each time the window opens. The workspace opened last (rows are sorted that way) is preselected.
  useEffect(() => {
    if (!open) return
    const preselected = workspaceId ?? rows.current[0]?.recordId ?? ''
    destPicked.current = false
    setStep(workspaceId || initial ? 'paper' : 'choose')
    setInput(initial?.input ?? '')
    setPeek(initial?.peek ?? null)
    setName(initial?.peek.suggestedWorkspaceName ?? '')
    setDest(preselected ? 'existing' : 'new')
    setWsId(preselected)
    setPicked(new Set())
    setPickQuery('')
    setError('')
    setBusy(false)
  }, [open, workspaceId, initial])

  // Workspaces that load after the window opened still preselect the one opened last.
  const hasWorkspaces = workspaces.rows.length > 0
  useEffect(() => {
    if (!open || workspaceId || wsId || !hasWorkspaces) return
    setWsId(workspaces.rows[0].recordId)
    if (!destPicked.current) setDest('existing')
  }, [open, workspaceId, wsId, hasWorkspaces, workspaces.rows])

  const pick = (d: Dest) => {
    destPicked.current = true
    setDest(d)
  }

  const a = allowance?.analyze
  // At the daily cap only a paper with no analysis yet is refused; one that exists (ready, running or failed) opens free.
  const blocked = !!peek && peek.status === 'new' && !!a && !a.allowed
  // A paper that exists already costs nothing to open, so it can open without being filed anywhere.
  const opensFree = !!peek && peek.status !== 'new'
  // Already filed in the chosen workspace: say so, and the action is to open it there.
  const alreadyIn =
    !!peek?.paperId && dest === 'existing' && !!wsId && workspaces.papersOf(wsId).some((p) => p.paperId === peek.paperId)
    ? workspaces.byId.get(wsId)?.data.name ?? 'this workspace'
    : ''

  async function lookUp(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await actions.peekPaper(input)
    setBusy(false)
    if (!r.success) return setError(r.error)
    setPeek(r.data)
    setName(r.data.suggestedWorkspaceName)
    // A new paper can't open without a workspace. (Read the rows through the ref: they may have loaded during the look-up.)
    if (r.data.status === 'new') setDest((d) => (d === 'none' ? (workspaceId || rows.current.length ? 'existing' : 'new') : d))
  }

  async function addPaper(e: FormEvent) {
    e.preventDefault()
    if (!peek || busy) return
    if (dest === 'none') {
      onClose()
      navigate(`/p/${arxivSlug(peek.arxivId)}`)
      return
    }
    if (alreadyIn) {
      onClose()
      navigate(`/w/${wsId}/p/${arxivSlug(peek.arxivId)}`)
      return
    }
    setBusy(true)
    setError('')
    const r =
      dest === 'new'
        ? await actions.addPaperToNewWorkspace(peek.arxivId, name.trim())
        : await actions.analyzePaper(peek.arxivId, wsId)
    setBusy(false)
    if (!r.success) return setError(r.error)
    const target = r.data.workspaceId ?? (dest === 'existing' ? wsId : '')
    onClose()
    navigate(target ? `/w/${target}/p/${arxivSlug(r.data.arxivId)}` : `/p/${arxivSlug(r.data.arxivId)}`)
  }

  async function createWorkspace(e: FormEvent) {
    e.preventDefault()
    if (!wsName.trim()) return setError('Give the workspace a name.')
    setBusy(true)
    setError('')
    try {
      const papers = library.entries.filter((e) => picked.has(e.id)).map((e) => ({ paperId: e.data.paperId, arxivId: e.data.arxivId, title: e.data.title }))
      const id = await library.createWorkspace(wsName, wsDescription, papers)
      if (id) {
        setWsName('')
        setWsDescription('')
        onClose()
        const recommend: FirstRecommendation = papers.length ? 'next' : 'starter'
        navigate(`/w/${id}`, { state: { recommend } })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.')
    } finally {
      setBusy(false)
    }
  }

  const title = step === 'choose' ? 'Add' : step === 'paper' ? 'Add a paper' : 'New workspace'
  const allowanceLine = a ? (
    <p className="mt-2 text-xs text-muted-foreground tabular-nums" data-testid="add-allowance">
      {a.remaining} of {a.used + a.remaining} new papers left today. Papers anyone already analyzed are free.
    </p>
  ) : null

  return (
    <BranchPanel open={open} onClose={onClose} returnFocus={returnFocus} title={title} header={allowanceLine} testId="add-dialog" closeLabel="Close" maxWidth={640}>
      {step === 'choose' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setStep('paper')} data-testid="add-choice-paper"
            className="press cursor-pointer rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-accent-soft">
            <LinkIcon size={18} className="text-primary" />
            <span className="mt-2 block font-semibold">A paper</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">Paste an arXiv link.</span>
          </button>
          <button type="button" onClick={() => setStep('workspace')} data-testid="add-choice-workspace"
            className="press cursor-pointer rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-accent-soft">
            <BookIcon size={18} className="text-primary" />
            <span className="mt-2 block font-semibold">A workspace</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">A subject to study, with recommended papers.</span>
          </button>
        </div>
      )}

      {step === 'paper' && (
        <div className="grid gap-4">
          <form onSubmit={lookUp} className="flex gap-2">
            <Input value={input} onChange={(e) => { setInput(e.target.value); setPeek(null) }} placeholder="arXiv link or id, e.g. 1706.03762" aria-label="arXiv link or id" data-testid="add-paper-input" autoFocus />
            <Button type="submit" variant={peek ? 'outline' : 'default'} loading={busy && !peek} data-testid="add-paper-lookup">Look up</Button>
          </form>

          {peek && (
            <form onSubmit={addPaper} className="grid gap-4" data-testid="add-paper-preview">
              <div className="rounded-lg border border-border bg-surface-2 p-3.5">
                <p className="font-semibold leading-snug" data-testid="add-paper-title">{peek.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {peek.authors.slice(0, 3).join(', ')}{peek.authors.length > 3 ? ' et al.' : ''}{peek.year && ` · ${peek.year}`} · <span className="font-mono">arXiv {peek.arxivId}</span>
                  {peek.categoryName && ` · ${peek.categoryName}`}
                </p>
                <p className="mt-1.5 text-xs" data-testid="add-paper-status">
                  {peek.analyzed ? (
                    <span className="text-known">Already analyzed. Opening it is free.</span>
                  ) : blocked ? (
                    <span className="text-destructive">
                      You've reached today's limit of {a.used + a.remaining} new papers.
                      {a.nextSlotAt > 0 && ` You can start this one after ${formatSlotTime(a.nextSlotAt)}.`} Papers someone already analyzed are still free to add.
                    </span>
                  ) : (
                    <span className="text-muted-foreground">New to Schema: analysis takes {ANALYSIS_TIME} and uses one of today's papers.</span>
                  )}
                </p>
              </div>

              <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                <legend className="label pb-1">Where should it go?</legend>
                {(hasWorkspaces || workspaceId) && (
                  <label className={cn('flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded border p-2.5', dest === 'existing' ? 'border-primary bg-accent-soft' : 'border-border')}>
                    <input type="radio" name="dest" checked={dest === 'existing'} onChange={() => pick('existing')} data-testid="dest-existing" />
                    <span className="text-sm">An existing workspace</span>
                    <select
                      value={wsId}
                      onChange={(e) => { setWsId(e.target.value); pick('existing') }}
                      aria-label="Workspace"
                      data-testid="dest-select"
                      className="ml-auto h-[30px] min-w-0 max-w-[55%] rounded border border-input bg-card px-2 text-sm"
                    >
                      {workspaces.rows.map((w) => <option key={w.recordId} value={w.recordId}>{w.data.name}</option>)}
                    </select>
                    {alreadyIn && (
                      <span className="basis-full pl-[23px] text-xs text-muted-foreground" data-testid="add-paper-already">Already in {alreadyIn}</span>
                    )}
                  </label>
                )}
                <label className={cn('flex cursor-pointer flex-wrap items-center gap-2.5 rounded border p-2.5', dest === 'new' ? 'border-primary bg-accent-soft' : 'border-border')}>
                  <input type="radio" name="dest" checked={dest === 'new'} onChange={() => pick('new')} data-testid="dest-new" />
                  <span className="text-sm">A new workspace named</span>
                  <Input value={name} onChange={(e) => { setName(e.target.value); pick('new') }} aria-label="New workspace name" data-testid="dest-name" className="h-[30px] flex-1 min-w-[160px]" />
                </label>
                {opensFree && (
                  <label className={cn('flex cursor-pointer items-center gap-2.5 rounded border p-2.5', dest === 'none' ? 'border-primary bg-accent-soft' : 'border-border')}>
                    <input type="radio" name="dest" checked={dest === 'none'} onChange={() => pick('none')} data-testid="dest-none" />
                    <span className="text-sm">Open without a workspace</span>
                  </label>
                )}
              </fieldset>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => (workspaceId || initial ? onClose() : setStep('choose'))}>Back</Button>
                <Button type="submit" loading={busy} disabled={blocked || (dest === 'new' ? !name.trim() : dest === 'existing' && !wsId)} data-testid="add-paper-submit">
                  {dest === 'none' || alreadyIn ? 'Open paper' : <><PlusIcon size={14} /> Add paper</>}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {step === 'workspace' && (
        <form onSubmit={createWorkspace} className="grid gap-3" data-testid="workspace-form">
          <label className="flex flex-col gap-1.5">
            <span className="label">Name</span>
            <Input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Machine Learning" aria-label="Workspace name" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">What you want to learn (optional)</span>
            <Textarea value={wsDescription} onChange={(e) => setWsDescription(e.target.value)} placeholder="Transformers and attention, starting from the basics" aria-label="Workspace description" rows={3} />
          </label>
          <LibraryPicker entries={library.entries} ready={library.ready} picked={picked} onPick={setPicked} query={pickQuery} onQuery={setPickQuery} />
          <p className="text-xs text-muted-foreground" data-testid="workspace-recommend-note">
            {picked.size
              ? "You'll get three recommended papers that follow on from the ones you add. That uses one of today's 10 recommendation runs."
              : "You'll get three starter papers for the subject right away. That uses one of today's 10 recommendation runs."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('choose')}>Back</Button>
            <Button type="submit" loading={busy} disabled={!workspaces.ready} data-testid="workspace-create">Create workspace</Button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="add-error">{error}</p>}
    </BranchPanel>
  )
}

/**
 * "Add papers from your Library" in the New workspace form: a search box over
 * a checklist of the reader's Library papers, with how many are checked. The
 * checked papers stay checked while the search hides them.
 */
function LibraryPicker({
  entries,
  ready,
  picked,
  onPick,
  query,
  onQuery,
}: {
  entries: readonly LibraryEntry[]
  ready: boolean
  picked: ReadonlySet<string>
  onPick: (next: Set<string>) => void
  query: string
  onQuery: (q: string) => void
}) {
  const uid = useId()
  const matches = useMemo(() => matchEntries(entries, query), [entries, query])
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    onPick(next)
  }
  return (
    <fieldset className="grid min-w-0 gap-1.5" data-testid="workspace-library-picker">
      <legend className="label pb-1.5">Add papers from your Library (optional)</legend>
      {!ready ? (
        <p className="text-sm text-muted-foreground">Loading your Library…</p>
      ) : !entries.length ? (
        <p className="text-sm text-muted-foreground">Your Library has no papers yet.</p>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onClear={() => onQuery('')}
            placeholder="Search your Library"
            aria-label="Search your Library"
            data-testid="workspace-library-search"
          />
          <ul className="max-h-48 overflow-y-auto overscroll-contain rounded border border-border bg-card p-1" aria-label="Papers in your Library">
            {matches.map((e) => {
              const id = `${uid}-${e.id}`
              return (
                <li key={e.id} className="flex min-w-0 items-start gap-2.5 rounded-[3px] px-2 py-1.5 hover:bg-accent" data-testid="workspace-library-option" data-arxiv={e.data.arxivId}>
                  <Checkbox id={id} checked={picked.has(e.id)} onCheckedChange={(on) => toggle(e.id, on)} className="mt-0.5" />
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm leading-snug">
                    <span className="block truncate">{e.data.title || `arXiv ${e.data.arxivId}`}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">arXiv {e.data.arxivId}</span>
                  </label>
                </li>
              )
            })}
            {!matches.length && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground" role="status">No papers match “{query.trim()}”.</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite" data-testid="workspace-library-count">
            {picked.size ? `${plural(picked.size, 'paper', 'papers')} will be added.` : 'None checked.'}
          </p>
        </>
      )}
    </fieldset>
  )
}

/** The primary Add button; opens the Add window. */
export function AddButton({ workspaceId, className, label, testId = 'add-open' }: { workspaceId?: string; className?: string; label?: string; testId?: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button ref={button} onClick={() => setOpen(true)} className={className} data-testid={testId}>
        <PlusIcon size={15} /> {label ?? (workspaceId ? 'Add paper' : 'Add paper or workspace')}
      </Button>
      <AddDialog open={open} onClose={() => setOpen(false)} workspaceId={workspaceId} returnFocus={() => button.current} />
    </>
  )
}
