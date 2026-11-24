/**
 * Workspace page: the current target paper, recommendations, picking a target
 * (from a suggestion or a pasted link), and the paper history.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { AnalyzeForm } from '../../../../components/AnalyzeForm'
import { useWorkspaces } from '../../../../hooks/useWorkspaces'
import { actions } from '../../../../lib/actions-client'
import { arxivSlug } from '../../../../lib/arxiv'
import type { PaperData } from '../../../../types'

export default function WorkspacePage() {
  const { id = '' } = useParams()
  const workspaces = useWorkspaces()
  const navigate = useNavigate()
  const ws = workspaces.byId.get(id)
  const currentArxiv = ws?.data.papers?.find((p) => p.paperId === ws.data.currentPaperId)?.arxivId
  const currentQ = useQuery<PaperData>('papers', { where: { arxivId: currentArxiv || '__none__' }, limit: 1 })
  const current = currentQ.records[0]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState('')

  const touched = useRef('')
  const { touch, ready } = workspaces
  useEffect(() => {
    if (!ready || !ws || touched.current === id) return
    touched.current = id
    void touch(id)
  }, [ready, ws, id, touch])

  if (workspaces.status === 'loading') return <div className="p-6 text-muted-foreground">Loading…</div>
  if (!ws) return <div className="p-6">Workspace not found. <Link to="/home" className="underline">Home</Link></div>

  const currentEntry = ws.data.papers?.find((p) => p.paperId === ws.data.currentPaperId)
  const targetFinished = currentEntry?.status === 'finished'

  async function recommend() {
    setBusy(true)
    setError('')
    const r = await actions.recommendPapers(id)
    setBusy(false)
    if (!r.success) setError(r.error)
  }

  async function pick(arxivId: string) {
    setPicking(arxivId)
    setError('')
    const r = await actions.analyzePaper(arxivId, id)
    setPicking('')
    if (!r.success) return setError(r.error)
    navigate(`/p/${arxivSlug(r.data.arxivId)}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="workspace-page">
      <header>
        <h1 className="text-2xl font-semibold" data-testid="workspace-name">{ws.data.name}</h1>
        {ws.data.description && <p className="text-sm text-muted-foreground">{ws.data.description}</p>}
      </header>

      <section className="rounded-lg border border-border bg-card p-4" data-testid="workspace-target">
        <h2 className="font-semibold">Current target</h2>
        {current ? (
          <p className="text-sm">
            <Link to={`/p/${arxivSlug(current.data.arxivId)}`} className="text-primary underline" data-testid="target-link">
              {current.data.title}
            </Link>{' '}
            <span className="text-xs text-muted-foreground">{targetFinished ? 'finished' : current.data.status}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No target yet. Get recommendations or paste a paper.</p>
        )}
      </section>

      <section className="space-y-3" data-testid="workspace-suggestions">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">{current && targetFinished ? 'Recommended next' : 'Recommended papers'}</h2>
          <Button size="sm" variant="outline" loading={busy} onClick={recommend} data-testid="recommend-button">
            {ws.data.suggestions?.length ? 'Refresh recommendations' : 'Recommend papers'}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive" data-testid="workspace-error">{error}</p>}
        <ul className="space-y-2">
          {(ws.data.suggestions ?? []).map((s) => (
            <li key={s.arxivId} className="rounded-lg border border-border p-3" data-testid="suggestion">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.authors?.join(', ')} · arXiv {s.arxivId}</p>
              <p className="mt-1 text-sm">{s.reason}</p>
              <Button className="mt-2" size="sm" loading={picking === s.arxivId} onClick={() => pick(s.arxivId)} data-testid="pick-suggestion">
                Study this paper
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Or paste a paper</h2>
        <AnalyzeForm workspaceId={id} />
      </section>

      <section data-testid="workspace-history">
        <h2 className="font-semibold">Papers in this workspace</h2>
        <ul className="space-y-1 text-sm">
          {(ws.data.papers ?? []).map((p) => (
            <li key={p.paperId}>
              <Link to={`/p/${arxivSlug(p.arxivId)}`} className="underline">{p.title || p.arxivId}</Link>{' '}
              <span className="text-xs text-muted-foreground">{p.status}</span>
            </li>
          ))}
          {(ws.data.papers ?? []).length === 0 && <li className="text-muted-foreground">None yet.</li>}
        </ul>
      </section>
    </div>
  )
}
