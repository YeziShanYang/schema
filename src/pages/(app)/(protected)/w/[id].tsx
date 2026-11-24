/**
 * Workspace view (list form). The floating paper graph is designed
 * separately; this page drives the same data through useWorkspaceGraph:
 * papers (active and finished) with progress, recommended candidates, adding
 * a paper by recommendation or pasted link, finishing, reopening, removing.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, ConfirmModal } from '@/components/ui'
import { AnalyzeForm } from '../../../../components/AnalyzeForm'
import { Chip, InlineEdit, Meter, PageHeader } from '../../../../components/blueprint'
import { SparkIcon } from '../../../../components/icons'
import { useWorkspaceGraph, type WorkspacePaperNode } from '../../../../hooks/useWorkspaceGraph'
import { useAllowance } from '../../../../hooks/useAllowance'
import { actions } from '../../../../lib/actions-client'
import { arxivSlug } from '../../../../lib/arxiv'

function PaperRow({ p, onOpen, onToggle, onRemove }: { p: WorkspacePaperNode; onOpen: () => void; onToggle: () => void; onRemove: () => void }) {
  const ratio = p.total ? p.known / p.total : 0
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_200px_auto] md:items-center" data-testid="workspace-paper" data-status={p.status} data-arxiv={p.arxivId}>
      <div className="min-w-0">
        <Link to={`/p/${arxivSlug(p.arxivId)}`} onClick={onOpen} className="font-medium text-foreground hover:text-primary" data-testid="workspace-paper-link">
          {p.title || p.arxivId}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">arXiv {p.arxivId}</span>
          {p.status === 'finished' && <Chip tone="known">Finished</Chip>}
          {p.analysis === 'processing' || p.analysis === 'queued' ? (
            <Chip tone="accent">Analyzing · {Math.round(p.analysisProgress * 100)}%</Chip>
          ) : p.analysis === 'failed' ? (
            <Chip tone="learning">Analysis failed</Chip>
          ) : null}
          {p.isLastOpened && <span>Last opened</span>}
        </div>
      </div>
      <div className="text-xs text-muted-foreground" data-testid="workspace-paper-progress">
        <div className="mb-1 flex justify-between tabular-nums">
          <span>Topics known</span>
          <b className="font-semibold text-foreground">{p.known} / {p.total}</b>
        </div>
        <Meter value={ratio} />
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onToggle} data-testid="workspace-paper-toggle">
          {p.status === 'finished' ? 'Read again' : 'Mark finished'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${p.title} from this workspace`}>
          Remove
        </Button>
      </div>
    </li>
  )
}

export default function WorkspacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const g = useWorkspaceGraph(id)
  const ws = g.workspace
  const { allowance } = useAllowance()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const touched = useRef('')
  const { touch, ready } = g.workspaces
  useEffect(() => {
    if (!ready || !ws || touched.current === id) return
    touched.current = id
    void touch(id)
  }, [ready, ws, id, touch])

  if (g.loading) return <div className="p-6 text-muted-foreground">Loading…</div>
  if (!ws) {
    return (
      <div className="p-6">
        Workspace not found. <Link to="/home" className="text-primary hover:underline">Home</Link>
      </div>
    )
  }

  async function recommend() {
    setBusy(true)
    setError('')
    const r = await actions.recommendPapers(id)
    setBusy(false)
    if (!r.success) setError(r.error)
  }

  async function add(arxivId: string) {
    setAdding(arxivId)
    setError('')
    const r = await actions.analyzePaper(arxivId, id)
    setAdding('')
    if (!r.success) setError(r.error)
  }

  const empty = g.papers.length === 0
  const recLeft = allowance?.recommend.remaining

  return (
    <div className="min-h-full" data-testid="workspace-page">
      <PageHeader
        label="Workspace"
        title={<InlineEdit value={ws.data.name} label="workspace name" onSave={async (v) => { if (v) await g.workspaces.update(id, { name: v }) }} />}
      >
        <Button variant="default" loading={busy} onClick={recommend} data-testid="recommend-button">
          <SparkIcon size={15} />
          {g.finished.length > 0 || g.active.length > 0 ? 'Recommend next paper' : 'Recommend papers'}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove workspace</Button>
      </PageHeader>

      <div className="mx-auto grid max-w-5xl gap-6 px-5 py-6 md:px-7">
        <div className="-mt-2 text-sm text-muted-foreground">
          <InlineEdit
            value={ws.data.description}
            label="workspace description"
            placeholder="Add what you want to learn, so recommendations fit"
            multiline
            onSave={(v) => g.workspaces.update(id, { description: v })}
          />
        </div>
        <span className="sr-only" data-testid="workspace-name">{ws.data.name}</span>

        {error && <p role="alert" className="text-sm text-destructive" data-testid="workspace-error">{error}</p>}

        {g.candidates.length > 0 && (
          <section data-testid="workspace-suggestions">
            <div className="flex items-baseline justify-between pb-2">
              <div className="label">Recommended for this workspace</div>
              {recLeft !== undefined && <span className="text-xs text-faint tabular-nums">{recLeft} recommendation runs left today</span>}
            </div>
            <ul className="grid gap-3 md:grid-cols-3">
              {g.candidates.map((s, i) => (
                <li key={s.arxivId} className="surface enter flex flex-col p-4" style={{ ['--i' as string]: i }} data-testid="suggestion">
                  <p className="font-semibold leading-snug">{s.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.authors?.slice(0, 3).join(', ')}{s.authors?.length > 3 ? ' et al.' : ''} · <span className="font-mono">arXiv {s.arxivId}</span></p>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{s.reason}</p>
                  <Button className="mt-3 self-start" size="sm" loading={adding === s.arxivId} onClick={() => add(s.arxivId)} data-testid="pick-suggestion">
                    Add to workspace
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section data-testid="workspace-papers">
          <div className="label pb-2">Papers</div>
          {empty ? (
            <div className="surface p-5 text-sm text-muted-foreground">
              No papers yet. Get recommendations from the button above, or paste a link below.
            </div>
          ) : (
            <ul className="surface divide-y divide-border">
              {[...g.active, ...g.finished].map((p) => (
                <PaperRow
                  key={p.paperId}
                  p={p}
                  onOpen={() => void g.workspaces.markOpened(id, p.paperId)}
                  onToggle={() => void g.workspaces.setPaperStatus(id, p.paperId, p.status === 'finished' ? 'active' : 'finished')}
                  onRemove={() => void g.workspaces.removePaper(id, p.paperId)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="surface p-4" data-testid="workspace-add">
          <div className="label pb-2">Add a paper by link</div>
          <AnalyzeForm workspaceId={id} stay />
        </section>
      </div>

      <ConfirmModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          await g.workspaces.remove(id)
          setConfirmRemove(false)
          navigate('/home')
        }}
        title="Remove this workspace?"
        description="Its paper list and recommendations are removed. Your knowledge profile and the papers themselves stay."
        confirmText="Remove workspace"
      />
    </div>
  )
}
