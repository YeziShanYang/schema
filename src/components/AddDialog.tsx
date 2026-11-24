/**
 * The one Add flow: a centered window with two paths.
 *
 * Paper: paste a link, look it up on arXiv (peekPaper, free), then choose
 * where it goes, a new workspace with a suggested name or an existing one,
 * and open its paper window. A new workspace is created on the server only
 * after the paper checks out.
 *
 * Workspace: name and optional description, then open it; the workspace
 * page asks for starter recommendations once.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button, Input, Textarea } from './ui'
import { BranchPanel } from './graph/BranchPanel'
import { BookIcon, LinkIcon, PlusIcon } from './icons'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useAllowance } from '../hooks/useAllowance'
import { actions, type PaperPeek } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'

type Step = 'choose' | 'paper' | 'workspace'

export function AddDialog({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId?: string }) {
  const navigate = useNavigate()
  const workspaces = useWorkspaces()
  const { allowance } = useAllowance()
  const [step, setStep] = useState<Step>(workspaceId ? 'paper' : 'choose')
  const [input, setInput] = useState('')
  const [peek, setPeek] = useState<PaperPeek | null>(null)
  const [dest, setDest] = useState<'new' | 'existing'>(workspaceId ? 'existing' : 'new')
  const [name, setName] = useState('')
  const [wsId, setWsId] = useState(workspaceId ?? '')
  const [wsName, setWsName] = useState('')
  const [wsDescription, setWsDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Start fresh each time the window opens.
  useEffect(() => {
    if (!open) return
    setStep(workspaceId ? 'paper' : 'choose')
    setInput('')
    setPeek(null)
    setDest(workspaceId ? 'existing' : 'new')
    setWsId(workspaceId ?? '')
    setError('')
    setBusy(false)
  }, [open, workspaceId])

  // Default the destination once workspaces have loaded.
  const hasWorkspaces = workspaces.rows.length > 0
  useEffect(() => {
    if (!workspaceId && !wsId && hasWorkspaces) setWsId(workspaces.rows[0].recordId)
  }, [workspaceId, wsId, hasWorkspaces, workspaces.rows])

  const a = allowance?.analyze

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
    if (!hasWorkspaces && !workspaceId) setDest('new')
  }

  async function addPaper(e: FormEvent) {
    e.preventDefault()
    if (!peek || busy) return
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
      const id = await workspaces.create(wsName, wsDescription)
      if (id) {
        setWsName('')
        setWsDescription('')
        onClose()
        navigate(`/w/${id}`, { state: { starter: true } })
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
    <BranchPanel open={open} onClose={onClose} title={title} eyebrow={workspaceId ? 'This workspace' : 'Add'} header={allowanceLine} testId="add-dialog" closeLabel="Close" maxWidth={640}>
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
                  {peek.analyzed ? <span className="text-known">Already analyzed. Opening it is free.</span> : <span className="text-muted-foreground">New to Schema: analysis takes about a minute and uses one of today's papers.</span>}
                </p>
              </div>

              <fieldset className="grid gap-2">
                <legend className="label pb-1">Where should it go?</legend>
                {(hasWorkspaces || workspaceId) && (
                  <label className={cn('flex cursor-pointer items-center gap-2.5 rounded border p-2.5', dest === 'existing' ? 'border-primary bg-accent-soft' : 'border-border')}>
                    <input type="radio" name="dest" checked={dest === 'existing'} onChange={() => setDest('existing')} data-testid="dest-existing" />
                    <span className="text-sm">An existing workspace</span>
                    <select
                      value={wsId}
                      onChange={(e) => { setWsId(e.target.value); setDest('existing') }}
                      aria-label="Workspace"
                      data-testid="dest-select"
                      className="ml-auto h-[30px] max-w-[55%] rounded border border-input bg-card px-2 text-sm"
                    >
                      {workspaces.rows.map((w) => <option key={w.recordId} value={w.recordId}>{w.data.name}</option>)}
                    </select>
                  </label>
                )}
                <label className={cn('flex cursor-pointer flex-wrap items-center gap-2.5 rounded border p-2.5', dest === 'new' ? 'border-primary bg-accent-soft' : 'border-border')}>
                  <input type="radio" name="dest" checked={dest === 'new'} onChange={() => setDest('new')} data-testid="dest-new" />
                  <span className="text-sm">A new workspace named</span>
                  <Input value={name} onChange={(e) => { setName(e.target.value); setDest('new') }} aria-label="New workspace name" data-testid="dest-name" className="h-[30px] flex-1 min-w-[160px]" />
                </label>
              </fieldset>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => (workspaceId ? onClose() : setStep('choose'))}>Back</Button>
                <Button type="submit" loading={busy} disabled={dest === 'new' ? !name.trim() : !wsId} data-testid="add-paper-submit">
                  <PlusIcon size={14} /> Add paper
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
          <p className="text-xs text-muted-foreground">You'll get three starter papers for the subject right away. That uses one of today's 10 recommendation runs.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('choose')}>Back</Button>
            <Button type="submit" loading={busy} disabled={!workspaces.ready}>Create workspace</Button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="add-error">{error}</p>}
    </BranchPanel>
  )
}

/** The primary Add button; opens the Add window. */
export function AddButton({ workspaceId, className, label, testId = 'add-open' }: { workspaceId?: string; className?: string; label?: string; testId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} className={className} data-testid={testId}>
        <PlusIcon size={15} /> {label ?? (workspaceId ? 'Add paper' : 'Add paper or workspace')}
      </Button>
      <AddDialog open={open} onClose={() => setOpen(false)} workspaceId={workspaceId} />
    </>
  )
}
