/**
 * Workspace page. By default a floating graph of the workspace's papers
 * around the workspace name, with recommended papers as dashed candidate
 * nodes that can be added or dismissed. The Graph | List toggle in the
 * header, shown at every width, swaps the graph for a list of the same
 * papers and recommendations (WorkspaceList), with papers not finished
 * first and each group most recently opened first. The view is kept in the
 * URL query (`?view=list`, or the graph when it is absent), and a change
 * replaces the history entry. The view is also remembered for the tab, so a
 * paper's link back here opens the same one. Dismissing takes the paper out of the
 * workspace's suggestions (useWorkspaces dismissSuggestion) with no confirm,
 * and a later recommendation run may suggest it again. A bar at the top says
 * where to continue. Data comes from useWorkspaceGraph; clicking a paper
 * opens its paper window. Removing the workspace keeps its papers in the
 * Library (useLibrary removeWorkspace).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, ConfirmModal } from '@/components/ui'
import { AddButton, type FirstRecommendation } from '../../../../../components/AddDialog'
import { FirstRunPrompt } from '../../../../../components/FirstRunPrompt'
import { InlineEdit, Segmented } from '../../../../../components/blueprint'
import { SparkIcon } from '../../../../../components/icons'
import { ConceptName } from '../../../../../components/MathText'
import { FloatingGraph } from '../../../../../components/graph/FloatingGraph'
import { CandidateNode, CenterCard, PaperNode } from '../../../../../components/graph/nodes'
import { analyzingText, paperMeta, suggestionMeta, WorkspaceList } from '../../../../../components/WorkspaceList'
import { useWorkspaceGraph } from '../../../../../hooks/useWorkspaceGraph'
import { useAllowance } from '../../../../../hooks/useAllowance'
import { useLibrary } from '../../../../../hooks/useLibrary'
import { useConceptKnowledge, useRoadmaps } from '../../../../../hooks/useReader'
import { actions } from '../../../../../lib/actions-client'
import { arxivSlug } from '../../../../../lib/arxiv'
import { recommendedSequence } from '../../../../../lib/graph/sequence'
import { listOrder, workspaceView, workspaceViewQuery, type WorkspaceView } from '../../../../../lib/workspace'
import { rememberWorkspaceView } from '../../../../../lib/workspace-return'
import type { ConceptData } from '../../../../../types'

const VIEW_LABEL: Record<WorkspaceView, string> = { graph: 'Graph', list: 'List' }
const EMPTY_TEXT = 'Get recommendations or paste a link to add the first paper.'

export default function WorkspacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const g = useWorkspaceGraph(id)
  const ws = g.workspace
  const roadmaps = useRoadmaps()
  const library = useLibrary()
  const knowledge = useConceptKnowledge()
  const { allowance } = useAllowance()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const location = useLocation()
  const recommendButton = useRef<HTMLButtonElement>(null)
  const viewRegion = useRef<HTMLDivElement>(null)

  // The view lives in the URL. A change replaces the entry, so Back leaves the workspace instead of undoing it.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = workspaceView(searchParams)
  const setView = useCallback(
    (next: WorkspaceView) => setSearchParams((prev) => workspaceViewQuery(prev, next), { replace: true }),
    [setSearchParams],
  )
  // Remembered for this tab, so a paper's link back to the workspace opens the same view (lib/workspace-return).
  useEffect(() => rememberWorkspaceView(id, view), [id, view])

  const touched = useRef('')
  const { touch, ready } = g.workspaces
  useEffect(() => {
    if (!ready || !ws || touched.current === id) return
    touched.current = id
    void touch(id)
  }, [ready, ws, id, touch])

  // A workspace created from the Add window asks for recommendations once: starter papers when it is empty,
  // and `next` picks that follow on from its papers when the window added some from the Library.
  const starterRan = useRef(false)
  useEffect(() => {
    const mode = (location.state as { recommend?: FirstRecommendation } | null)?.recommend
    if (!mode || starterRan.current || !ws) return
    starterRan.current = true
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    if ((ws.data.suggestions?.length ?? 0) > 0 || (mode === 'starter' && g.papers.length > 0)) return
    void (async () => {
      setBusy(true)
      setError('')
      const r = await actions.recommendPapers(id, mode)
      setBusy(false)
      if (!r.success) setError(r.error)
    })()
  }, [location, ws, id, navigate, g.papers.length])

  // Continue: the most recently opened paper in this workspace that isn't finished.
  const continuePaper = useMemo(() => {
    const active = g.active.filter((p) => p.analysis === 'ready')
    const opened = (pid: string) => roadmaps.byPaper.get(pid)?.data.lastOpenedAt ?? 0
    return [...active].sort((a, b) => opened(b.paperId) - opened(a.paperId) || (b.isLastOpened ? 1 : 0) - (a.isLastOpened ? 1 : 0))[0] ?? null
  }, [g.active, roadmaps.byPaper])
  const listed = useMemo(
    () => (view === 'list' ? listOrder(g.papers, (pid) => roadmaps.byPaper.get(pid)?.data.lastOpenedAt) : []),
    [view, g.papers, roadmaps.byPaper],
  )
  const contConcepts = useQuery<ConceptData>('concepts', { where: { paperId: continuePaper?.paperId ?? '__none__' }, limit: 200 })
  const nextUp = useMemo(() => {
    if (!continuePaper?.paper) return null
    return recommendedSequence(
      continuePaper.paper.data.branches ?? [],
      contConcepts.records.map((c) => ({ ...c.data, dependsOn: c.data.dependsOn ?? [], id: c.recordId })),
      (c) => knowledge.statusOf(c.id),
    ).nextUp
  }, [continuePaper, contConcepts.records, knowledge.statusOf])

  // A dismissal removes the focused button with its card, so focus moves to the dismiss button now in the
  // same place, or to Recommend when no recommendation is left.
  const refocus = useRef<{ arxivId: string; index: number } | null>(null)
  useEffect(() => {
    const r = refocus.current
    if (!r || g.candidates.some((s) => s.arxivId === r.arxivId)) return
    refocus.current = null
    const buttons = viewRegion.current?.querySelectorAll<HTMLButtonElement>('[data-testid="dismiss-suggestion"]') ?? []
    ;(buttons[Math.min(r.index, buttons.length - 1)] ?? recommendButton.current)?.focus()
  }, [g.candidates])

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
    const r = await actions.recommendPapers(id, g.papers.length === 0 && g.candidates.length === 0 ? 'starter' : 'next')
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

  async function dismiss(arxivId: string) {
    setError('')
    if (document.activeElement?.closest('[data-testid="dismiss-suggestion"]')) {
      refocus.current = { arxivId, index: g.candidates.findIndex((s) => s.arxivId === arxivId) }
    }
    try {
      await g.workspaces.dismissSuggestion(id, arxivId)
    } catch {
      refocus.current = null
      setError('Could not dismiss the recommendation. Try again.')
    }
  }

  const open = (arxivId: string) => navigate(`/w/${id}/p/${arxivSlug(arxivId)}`)
  const finishedCount = g.finished.length
  const recLeft = allowance?.recommend.remaining

  const center = (
    <CenterCard label="Workspace" className="w-[300px]">
      <h2 className="mb-1 mt-1.5 text-[21px] font-semibold leading-tight" data-testid="workspace-name">{ws.data.name}</h2>
      {ws.data.description && <p className="mb-2 text-[13px] text-muted-foreground">{ws.data.description}</p>}
      <p className="text-xs text-muted-foreground tabular-nums">
        {g.papers.length} {g.papers.length === 1 ? 'paper' : 'papers'}
        {finishedCount > 0 && ` · ${finishedCount} finished`}
        {g.candidates.length > 0 && ` · ${g.candidates.length} recommended`}
      </p>
      {g.papers.length === 0 && g.candidates.length === 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">{EMPTY_TEXT}</p>
      )}
    </CenterCard>
  )

  const nodes = [
    ...g.papers.map((p) => ({
      key: `paper:${p.paperId}`,
      content: (
        <PaperNode
          arxivId={p.arxivId}
          status={p.status}
          title={p.title || p.arxivId}
          meta={paperMeta(p)}
          known={p.known}
          total={p.total}
          finished={p.status === 'finished'}
          analyzing={analyzingText(p)}
          failed={p.analysis === 'failed'}
          onOpen={() => open(p.arxivId)}
        />
      ),
    })),
    ...g.candidates.map((s) => ({
      key: `candidate:${s.arxivId}`,
      dashed: true,
      content: (
        <CandidateNode
          arxivId={s.arxivId}
          title={s.title}
          reason={s.reason}
          meta={suggestionMeta(s)}
          busy={adding === s.arxivId}
          disabled={!!adding && adding !== s.arxivId}
          dismissDisabled={!g.workspaces.ready || adding === s.arxivId}
          onAdd={() => add(s.arxivId)}
          onDismiss={() => dismiss(s.arxivId)}
        />
      ),
    })),
  ]

  return (
    <div className="flex min-h-[calc(100vh-48px)] flex-col md:min-h-screen" data-testid="workspace-page">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card px-5 pb-3.5 pt-5 md:px-7">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.01em]">
            <InlineEdit value={ws.data.name} label="workspace name" onSave={async (v) => { if (v) await g.workspaces.update(id, { name: v }) }} />
          </h1>
          <div className="mt-0.5 text-sm text-muted-foreground">
            <InlineEdit value={ws.data.description} label="workspace description" placeholder="Add what you want to learn, so recommendations fit" multiline onSave={(v) => g.workspaces.update(id, { description: v })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Workspace view" options={['graph', 'list'] as const} labels={VIEW_LABEL} value={view} onChange={setView} testId="workspace-view" />
          <Button ref={recommendButton} variant="outline" loading={busy} onClick={recommend} data-testid="recommend-button">
            <SparkIcon size={15} /> {g.papers.length ? 'Recommend next paper' : 'Recommend papers'}
          </Button>
          <AddButton workspaceId={id} label="Add paper" testId="add-paper-open" />
          <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-5 py-2.5 text-[13px] md:px-7" data-testid="workspace-continue">
        {busy && !continuePaper ? (
          <span className="text-muted-foreground" data-testid="finding-papers">Finding papers for this subject…</span>
        ) : continuePaper ? (
          <span>
            <span className="label mr-2">Continue</span>
            <Link to={`/w/${id}/p/${arxivSlug(continuePaper.arxivId)}`} className="font-medium text-foreground hover:text-primary">{continuePaper.title}</Link>
            {nextUp && <span className="text-muted-foreground">, next up <b className="font-semibold text-foreground"><ConceptName name={nextUp.name} /></b></span>}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {g.candidates.length > 0 ? 'Add one of the recommended papers below, or paste a link.' : 'Pick a paper to start.'}
          </span>
        )}
        <span className="flex items-center gap-3">
          {error && <span role="alert" className="text-destructive" data-testid="workspace-error">{error}</span>}
          {recLeft !== undefined && <span className="text-xs text-faint tabular-nums">{recLeft} recommendation runs left today</span>}
        </span>
      </section>

      <FirstRunPrompt className="mx-5 mt-4 md:mx-7" />

      <div ref={viewRegion} className="relative flex flex-1 flex-col">
        {view === 'list' ? (
          <WorkspaceList
            workspaceId={id}
            papers={listed}
            candidates={g.candidates}
            loading={g.workspaces.papersStatus === 'loading'}
            emptyText={EMPTY_TEXT}
            adding={adding}
            dismissDisabled={!g.workspaces.ready}
            onAdd={add}
            onDismiss={dismiss}
          />
        ) : (
          <FloatingGraph label={`Papers in ${ws.data.name}`} testId="workspace-graph" className="min-h-[560px] flex-1" center={center} nodes={nodes} />
        )}
      </div>

      <ConfirmModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          await library.removeWorkspace(id)
          setConfirmRemove(false)
          navigate('/home')
        }}
        title="Remove this workspace?"
        description="Its recommendations are removed. Its papers stay in your Library, and your checkmarks and knowledge profile stay."
        confirmText="Remove workspace"
      />
    </div>
  )
}
