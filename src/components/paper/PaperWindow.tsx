/**
 * The paper window: the paper at the center with its branches floating
 * around it. Clicking a branch opens a wide centered panel with the branch's
 * concepts in two columns; links load lazily when a branch opens. A
 * Walkthrough tab lists the paper's sections, and their concept chips open
 * the concept in its branch. The overview window (step 0 of the sequence)
 * opens on its own the first time a reader sees a paper they have not read
 * the overview of, and from the center card, the strip and concept cards.
 * Used at /p/[arxivId] (also signed out, in demo mode) and at
 * /w/[id]/p/[arxivId] inside a workspace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button, Checkbox, Label, Modal } from '@/components/ui'
import { cn } from '@/lib/utils'
import { arxivAbsUrl, parseArxivId } from '../../lib/arxiv'
import { usePaper, useFinishPaper } from '../../hooks/usePaper'
import { useReaderKnowledge } from '../../hooks/useDemoKnowledge'
import { useRoadmaps } from '../../hooks/useReader'
import { useOverview } from '../../hooks/useOverview'
import { useAllowance } from '../../hooks/useAllowance'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { actions } from '../../lib/actions-client'
import { AnalyzeForm } from '../AnalyzeForm'
import { AnalysisProgress, useAnalysisPhase } from './AnalysisProgress'
import { Chip, Meter } from '../blueprint'
import { FloatingGraph } from '../graph/FloatingGraph'
import { BranchNode, CenterCard } from '../graph/nodes'
import { BranchPanel } from '../graph/BranchPanel'
import { ConceptCard } from './ConceptCard'
import { OverviewWindow, type OverviewConcept } from './OverviewWindow'
import { SequenceStrip } from './SequenceStrip'
import { ConceptName, MathText } from '../MathText'
import { BookIcon } from '../icons'

function readPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable; the choice just isn't remembered
  }
}

export function PaperWindow({ arxivId, workspaceId }: { arxivId: string; workspaceId?: string }) {
  const { isSignedIn } = useAuth()
  const knowledge = useReaderKnowledge()
  const p = usePaper(arxivId, knowledge)
  const roadmaps = useRoadmaps()
  const workspaces = useWorkspaces()
  const finishPaper = useFinishPaper()
  const { allowance } = useAllowance()
  const ws = workspaceId ? workspaces.byId.get(workspaceId) : undefined
  // The progress view stands in for the graph until the paper is ready, then cross-fades out over it.
  const analysis = useAnalysisPhase(p.paper?.recordId, p.paper?.data.status)
  const covered = analysis === 'on' || analysis === 'hold'

  const viewKey = `schema:view:${arxivId}`
  const [view, setView] = useState<'graph' | 'walkthrough'>(() => (readPref(viewKey) === 'walkthrough' ? 'walkthrough' : 'graph'))
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [focusConcept, setFocusConcept] = useState('')
  const [finishOpen, setFinishOpen] = useState(false)
  const [markRest, setMarkRest] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [loadingBranches, setLoadingBranches] = useState<Set<string>>(() => new Set())
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({})
  const branchButtons = useRef(new Map<string, HTMLButtonElement | null>())
  const lastOpened = useRef<string | null>(null)
  // What opened the panel when it was not a branch node (a walkthrough chip), so focus returns there.
  const lastTrigger = useRef<HTMLElement | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [overviewFocus, setOverviewFocus] = useState('')
  // Set once this page has decided whether the overview opens on its own (tests wait for it).
  const [overviewSettled, setOverviewSettled] = useState(false)
  const overviewTrigger = useRef<HTMLElement | null>(null)
  const overviewButton = useRef<HTMLButtonElement | null>(null)
  // When one panel closes because the other opens, the closing one leaves focus to the opening one.
  const branchHandoff = useRef(false)
  const overviewHandoff = useRef(false)

  const paper = p.paper
  const ov = useOverview(paper, { signedIn: !!isSignedIn, isDemo: knowledge.isDemo })
  const roadmap = paper ? roadmaps.byPaper.get(paper.recordId) : undefined
  const finished = roadmap?.data.status === 'finished'

  // Remember this paper (library) and, inside a workspace, that it was opened last.
  // Each is marked once, when its own data is ready (workspaces can load after roadmaps).
  const touched = useRef('')
  const openedIn = useRef('')
  const { touch, ready: roadmapsReady } = roadmaps
  const { markOpened, ready: wsReady } = workspaces
  useEffect(() => {
    if (!paper || !isSignedIn || !roadmapsReady || touched.current === paper.recordId) return
    touched.current = paper.recordId
    void touch({ paperId: paper.recordId, arxivId: paper.data.arxivId, title: paper.data.title })
  }, [paper, isSignedIn, roadmapsReady, touch])
  useEffect(() => {
    if (!paper || !isSignedIn || !workspaceId || !wsReady) return
    const key = `${workspaceId}:${paper.recordId}`
    if (openedIn.current === key) return
    openedIn.current = key
    void markOpened(workspaceId, paper.recordId)
  }, [paper, isSignedIn, workspaceId, wsReady, markOpened])

  const loadLinks = useCallback(
    async (branchKey: string) => {
      if (!paper) return
      setLoadingBranches((s) => new Set(s).add(branchKey))
      setLinkErrors((e) => ({ ...e, [branchKey]: '' }))
      let more = true
      // A large branch can take more than one call; finishing a branch counts once.
      for (let i = 0; more && i < 4; i++) {
        const r = await actions.loadBranchResources(paper.recordId, branchKey)
        if (!r.success) {
          setLinkErrors((e) => ({ ...e, [branchKey]: r.error }))
          break
        }
        more = r.data.remaining > 0
      }
      setLoadingBranches((s) => {
        const n = new Set(s)
        n.delete(branchKey)
        return n
      })
    },
    [paper],
  )

  // Opening a branch loads its links if any of its topics have none yet.
  const openBranch = useCallback(
    (key: string, concept?: string, trigger?: HTMLElement | null) => {
      lastOpened.current = key
      lastTrigger.current = trigger ?? null
      branchHandoff.current = false
      setOpenKey(key)
      if (concept) setFocusConcept(concept)
      if (isSignedIn && p.linksForBranch(key) === 'needs-load' && !loadingBranches.has(key)) void loadLinks(key)
    },
    [isSignedIn, p, loadingBranches, loadLinks],
  )

  // Scroll a requested concept into view once its panel is open.
  useEffect(() => {
    if (!focusConcept || !openKey) return
    const t = setTimeout(() => {
      const el = document.getElementById(`concept-${focusConcept}`)
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        setFocusConcept('')
      }
    }, 60)
    return () => clearTimeout(t)
  }, [focusConcept, openKey])

  const openConceptByKey = useCallback(
    (key: string, trigger?: HTMLElement | null) => {
      const c = p.conceptByKey.get(key)
      if (c) openBranch(c.data.branchKey, key, trigger)
    },
    [p.conceptByKey, openBranch],
  )

  // The overview closes the branch panel if one is open, and focus goes back to what opened it.
  const openOverview = useCallback(
    (focus?: string, trigger?: HTMLElement | null) => {
      overviewTrigger.current = trigger ?? null
      overviewHandoff.current = false
      setOverviewFocus(focus ?? '')
      if (openKey) {
        branchHandoff.current = true
        setOpenKey(null)
      }
      setOverviewOpen(true)
    },
    [openKey],
  )
  const leaveOverviewFor = useCallback((branchKey: string, concept: string) => {
    overviewHandoff.current = true
    setOverviewOpen(false)
    openBranch(branchKey, concept)
  }, [openBranch])

  // Open the overview on its own once: the first time this browser shows the paper while it is unread.
  const autoChecked = useRef('')
  const { autoOpen, markAutoOpened, known: overviewKnown } = ov
  useEffect(() => {
    if (!paper || paper.data.status !== 'ready' || !ov.overview || !overviewKnown || autoChecked.current === paper.recordId) return
    autoChecked.current = paper.recordId
    if (autoOpen) {
      markAutoOpened()
      openOverview()
    }
    setOverviewSettled(true)
  }, [paper, ov.overview, overviewKnown, autoOpen, markAutoOpened, openOverview])

  const { statusOf } = knowledge
  const overviewConcepts = useMemo(
    () => new Map<string, OverviewConcept>(p.sequence.concepts.map((c) => [c.key, { key: c.key, name: c.name, known: statusOf(c.topicKey) === 'known' }])),
    [p.sequence, statusOf],
  )

  const branch = useMemo(() => p.branches.find((b) => b.key === openKey) ?? null, [p.branches, openKey])

  if (!parseArxivId(arxivId)) {
    return (
      <div className="grid max-w-xl gap-3 p-6" data-testid="paper-invalid">
        <h1 className="text-xl font-semibold">That is not an arXiv paper id</h1>
        <p className="text-sm text-muted-foreground">
          Paper links look like <span className="font-mono">/p/1706~03762</span>. Paste an arXiv link on the home page to open a paper.
        </p>
        <Link to={isSignedIn ? '/home' : '/'} className="text-sm text-primary hover:underline">← {isSignedIn ? 'Home' : 'Schema'}</Link>
      </div>
    )
  }
  if (p.loading) return <div className="p-6 text-muted-foreground">Loading…</div>

  const backTo = ws ? { to: `/w/${ws.recordId}`, label: ws.data.name } : knowledge.isDemo ? { to: '/', label: 'Schema' } : { to: '/home', label: 'Home' }

  if (!paper) {
    return (
      <div className="grid max-w-2xl gap-4 p-6" data-testid="paper-missing">
        <Link to={backTo.to} className="text-sm text-primary hover:underline">← {backTo.label}</Link>
        <h1 className="text-xl font-semibold">arXiv {arxivId} has not been analyzed yet</h1>
        <AnalyzeForm initialValue={arxivId} workspaceId={workspaceId} />
      </div>
    )
  }

  const d = paper.data
  const year = d.publishedAt ? d.publishedAt.slice(0, 4) : ''
  const firstAuthor = d.authors?.[0] ? `${d.authors[0].split(' ').slice(-1)[0]}${d.authors.length > 1 ? ' et al.' : ''}` : ''
  const seq = p.sequence
  const overviewUnread = !!ov.overview && ov.known && !ov.read
  const stepOf = new Map(seq.steps.map((s) => [s.branchKey, s]))
  const branchLinks = branch ? p.linksForBranch(branch.key) : 'ready'
  const branchLoading = branch ? loadingBranches.has(branch.key) || branchLinks === 'loading' : false
  const linksState: 'loading' | 'signin' | null = branchLoading ? 'loading' : !isSignedIn && branchLinks === 'needs-load' ? 'signin' : null

  const reopen = async () => {
    await roadmaps.setStatus(paper.recordId, 'reading')
    for (const w of workspaces.rows) {
      if (workspaces.papersOf(w.recordId).some((x) => x.paperId === paper.recordId)) await workspaces.setPaperStatus(w.recordId, paper.recordId, 'active')
    }
  }

  const finishControls = finished ? (
    <span className="flex items-center gap-2">
      <Chip tone="known"><span data-testid="paper-finished">Finished</span></Chip>
      {isSignedIn && <Button size="sm" variant="ghost" onClick={reopen} data-testid="read-again">Read again</Button>}
    </span>
  ) : isSignedIn && d.status === 'ready' ? (
    <Button size="sm" variant="outline" onClick={() => setFinishOpen(true)} data-testid="finish-toggle">Mark finished</Button>
  ) : null

  const center = (
    <CenterCard label="Paper" className="w-[320px]" testId="paper-card" onOpen={ov.overview && d.status === 'ready' ? () => openOverview(undefined, overviewButton.current) : undefined}>
      <h2 className="mb-1 mt-1.5 text-[19px] font-semibold leading-tight">{d.title}</h2>
      <p className="mb-3 text-[13px] text-muted-foreground">
        {firstAuthor}{year && ` · ${year}`} · <span className="font-mono">arXiv {d.arxivId}</span>
      </p>
      {/* Queued, running and failed papers show AnalysisProgress in place of the graph. */}
      {d.status === 'ready' && (
        <>
          <div className="mb-1.5 flex items-center justify-between text-[12.5px] text-muted-foreground" data-testid="paper-progress-count">
            <span>{knowledge.isDemo ? 'Concepts known (demo)' : 'Concepts known'}</span>
            <b className="font-semibold text-foreground tabular-nums">{p.progress.known} / {p.progress.total}</b>
          </div>
          <Meter value={p.progress.ratio} />
          {(ov.overview || ov.generating || finishControls) && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {ov.overview ? (
                <Button ref={overviewButton} size="sm" variant={overviewUnread ? 'default' : 'outline'} onClick={(e) => openOverview(undefined, e.currentTarget)} data-testid="open-overview">
                  <BookIcon size={14} /> Overview
                </Button>
              ) : ov.generating ? (
                <span className="text-xs text-muted-foreground" data-testid="overview-generating">Writing the overview…</span>
              ) : null}
              {finishControls}
            </div>
          )}
        </>
      )}
    </CenterCard>
  )

  return (
    <div
      className="flex min-h-[calc(100vh-48px)] flex-col md:min-h-screen"
      data-testid="paper-page"
      data-paper-status={d.status}
      data-overview={ov.overview ? (ov.known ? (ov.read ? 'read' : 'unread') : 'loading') : 'none'}
      data-overview-settled={overviewSettled || undefined}
      data-overview-open={overviewOpen || undefined}
    >
      {knowledge.isDemo && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent-soft px-5 py-2 text-sm md:px-7" data-testid="demo-banner" role="status">
          <span>Demo: your progress isn't saved. Sign in to keep it.</span>
          <Button size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card px-5 pb-3 pt-4 md:px-7">
        <div className="min-w-0">
          <Link to={backTo.to} className="text-[13px] text-primary hover:underline" data-testid="paper-back">← {backTo.label}</Link>
          <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-balance" data-testid="paper-title">{d.title}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {d.authors?.slice(0, 4).join(', ')}{d.authors?.length > 4 ? ' et al.' : ''}{year && ` · ${year}`} ·{' '}
            <a href={arxivAbsUrl(d.arxivId)} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">arXiv {d.arxivId}</a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.concepts.length > 0 && !covered && (
            <nav className="flex w-fit gap-1 rounded-[7px] border border-border bg-surface-2 p-[3px]" aria-label="Paper view">
              {(['graph', 'walkthrough'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => { setView(v); writePref(viewKey, v) }}
                  data-testid={v === 'walkthrough' ? 'view-walkthrough' : 'view-branches'}
                  className={cn('press cursor-pointer rounded-[3px] border border-transparent px-3 py-1 text-sm font-medium', view === v ? 'border-transparent bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
                >
                  {v === 'graph' ? 'Branches' : 'Walkthrough'}
                </button>
              ))}
            </nav>
          )}
          {ws && isSignedIn && (
            <Button size="sm" variant="ghost" onClick={async () => { await workspaces.removePaper(ws.recordId, paper.recordId) }} data-testid="remove-from-workspace">
              Remove from workspace
            </Button>
          )}
        </div>
      </header>

      {p.concepts.length > 0 && d.status === 'ready' && (
        <SequenceStrip
          steps={overviewUnread ? seq.steps.map((st) => (st.state === 'current' ? { ...st, state: 'upcoming' as const } : st)) : seq.steps}
          overview={ov.overview ? { state: !ov.known ? 'upcoming' : ov.read ? 'done' : 'current' } : null}
          onOpenBranch={(key) => openBranch(key)}
          onOpenOverview={(el) => openOverview(undefined, el)}
          action={
            // Step 0 comes first even when every concept is known: the overview still tells the paper's story.
            ov.overview && !ov.known ? null : overviewUnread ? (
              <Button size="sm" className="h-[34px] max-[639px]:w-full" onClick={(e) => openOverview(undefined, e.currentTarget)} data-testid="next-up">
                Next up: Read the overview
              </Button>
            ) : seq.allKnown ? (
              <span className="flex h-[34px] items-center gap-2 text-[13px]" data-testid="sequence-done">
                <span className="font-medium text-known">All concepts known</span>
                {!finished && isSignedIn && <Button size="sm" onClick={() => setFinishOpen(true)}>Mark finished</Button>}
              </span>
            ) : seq.nextUp ? (
              <Button
                size="sm"
                className="h-[34px] max-w-[min(28rem,40vw)] max-[639px]:w-full max-[639px]:max-w-full"
                title={`Next up: ${seq.nextUp.name}`}
                onClick={() => openBranch(seq.nextUp!.branchKey, seq.nextUp!.key)}
                data-testid="next-up"
              >
                <span className="truncate">
                  Next up: <ConceptName name={seq.nextUp.name} />
                </span>
              </Button>
            ) : null
          }
        />
      )}

      {analysis !== 'off' && (
        <AnalysisProgress
          phase={analysis}
          paper={paper}
          branches={p.branches}
          order={seq.steps.map((s) => s.branchKey)}
          signedIn={!!isSignedIn}
          onSignIn={() => setShowAuth(true)}
        />
      )}
      {covered ? null : view === 'walkthrough' && p.sections.length > 0 ? (
        <div className="grid max-w-4xl gap-3 px-5 py-5 md:px-7">
          {finishControls && <div>{finishControls}</div>}
          <ol className="grid gap-3" data-testid="walkthrough">
            {p.sections.map((s) => (
              <li key={s.recordId} className="surface p-4">
                <h3 className="font-semibold">{s.data.heading}</h3>
                <p className="mt-1 text-sm text-muted-foreground"><MathText text={s.data.summary} /></p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {(s.data.conceptKeys ?? []).map((k) => {
                    const c = p.conceptByKey.get(k)
                    if (!c) return null
                    return (
                      <button key={k} type="button" data-testid="walkthrough-chip" onClick={(e) => openConceptByKey(k, e.currentTarget)}
                        className="press cursor-pointer rounded-[3px] border border-border bg-surface-2 px-2 py-0.5 text-xs hover:bg-accent-soft">
                        <ConceptName name={c.data.name} />
                      </button>
                    )
                  })}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col">
          <FloatingGraph
            label={`Branches of ${d.title}`}
            testId="paper-graph"
            className="min-h-[560px] flex-1"
            center={center}
            nodes={[...p.branches]
              .sort((a, b) => (stepOf.get(a.key)?.index ?? 99) - (stepOf.get(b.key)?.index ?? 99))
              .map((b) => {
                const step = stepOf.get(b.key)
                return {
                  key: b.key,
                  hot: openKey === b.key,
                  content: (
                    <BranchNode
                      ref={(el) => {
                        branchButtons.current.set(b.key, el)
                      }}
                      branchKey={b.key}
                      name={b.name}
                      known={b.known}
                      total={b.total}
                      step={step?.index}
                      // While the overview is unread it is the current step, so no branch claims "Start here" yet.
                      current={step?.state === 'current' && !overviewUnread ? (seq.fresh ? 'start' : 'continue') : null}
                      open={openKey === b.key}
                      onOpen={() => openBranch(b.key)}
                    />
                  ),
                }
              })}
          />
          {p.branches.length > 0 && (
            <p className="pointer-events-none absolute bottom-4 right-5 hidden text-xs text-faint md:block">
              Click a branch to open it. Drag one and it settles back.
            </p>
          )}
        </div>
      )}

      <BranchPanel
        open={!!branch}
        onClose={() => setOpenKey(null)}
        returnFocus={() =>
          branchHandoff.current
            ? null
            : lastTrigger.current?.isConnected
            ? lastTrigger.current
            : lastOpened.current
              ? branchButtons.current.get(lastOpened.current) ?? null
              : null
        }
        title={branch?.name ?? ''}
        eyebrow={branch ? `${branch.known} of ${branch.total} known` : ''}
        description={branch?.description}
        header={
          branch && (
            <div className="mt-3 grid gap-2">
              <Meter value={branch.total ? branch.known / branch.total : 0} />
              <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="branch-links" data-links={branchLoading ? 'loading' : branchLinks}>
                {branchLoading && <span className="text-muted-foreground">Finding explainer links for this branch…</span>}
                {!branchLoading && branchLinks === 'needs-load' && isSignedIn && (
                  <Button size="sm" variant="outline" onClick={() => loadLinks(branch.key)} data-testid="load-links">
                    Load explainer links
                  </Button>
                )}
                {!branchLoading && branchLinks === 'needs-load' && !isSignedIn && (
                  <span className="text-muted-foreground">
                    <button type="button" className="text-primary hover:underline" onClick={() => setShowAuth(true)}>Sign in</button> to load explainer links for this branch.
                  </span>
                )}
                {linkErrors[branch.key] && <span role="alert" className="text-destructive">{linkErrors[branch.key]}</span>}
                {isSignedIn && allowance && branchLinks !== 'ready' && (
                  <span className="text-xs text-faint tabular-nums">{allowance.branch.remaining} branch link loads left today</span>
                )}
              </div>
            </div>
          )
        }
      >
        {branch && (
          <ul className="grid gap-3 min-[900px]:grid-cols-2" data-testid="branch-concepts">
            {seq.concepts
              .filter((sc) => sc.branchKey === branch.key)
              .map((sc) => p.conceptByKey.get(sc.key)!)
              .filter(Boolean)
              .map((c) => (
              <ConceptCard
                key={c.recordId}
                stepIndex={seq.stepInBranch.get(c.data.key)}
                nextUp={seq.nextUp?.key === c.data.key}
                concept={c}
                paper={paper}
                topic={p.topicsByKey.get(c.data.topicKey)?.data}
                prerequisites={(c.data.dependsOn ?? []).map((k) => ({ key: k, name: p.conceptByKey.get(k)?.data.name ?? k }))}
                onOpenConcept={openConceptByKey}
                onSeeInOverview={ov.overview ? () => openOverview(c.data.key, branchButtons.current.get(c.data.branchKey) ?? null) : undefined}
                status={knowledge.statusOf(c.data.topicKey)}
                knowledge={knowledge}
                signedIn={!!isSignedIn}
                explainLeft={allowance?.explain.remaining}
                linksState={linksState}
                onSignIn={() => setShowAuth(true)}
              />
            ))}
          </ul>
        )}
      </BranchPanel>

      {ov.overview && (
        <OverviewWindow
          open={overviewOpen}
          onClose={() => setOverviewOpen(false)}
          returnFocus={() =>
            overviewHandoff.current
              ? null
              : overviewTrigger.current?.isConnected
                ? overviewTrigger.current
                : overviewButton.current
          }
          paperTitle={d.title}
          overview={ov.overview}
          concepts={overviewConcepts}
          focusKey={overviewFocus || undefined}
          read={ov.read}
          onReadChange={(v) => void ov.setRead(v)}
          nextUpName={seq.nextUp?.name ?? null}
          onStart={() => (seq.nextUp ? leaveOverviewFor(seq.nextUp.branchKey, seq.nextUp.key) : setOverviewOpen(false))}
          onOpenConcept={(key) => {
            const c = p.conceptByKey.get(key)
            if (c) leaveOverviewFor(c.data.branchKey, key)
          }}
        />
      )}

      <Modal open={finishOpen} onClose={() => setFinishOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Mark this paper finished?</Modal.Title>
          <Modal.Description>It moves to Finished in your library and in its workspaces. You can read it again later.</Modal.Description>
        </Modal.Header>
        <div className="flex items-center gap-2" data-testid="finish-panel">
          <Checkbox id="mark-rest" checked={markRest} onCheckedChange={setMarkRest} />
          <Label htmlFor="mark-rest">Also mark the remaining topics in this paper as known</Label>
        </div>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setFinishOpen(false)}>Cancel</Button>
          <Button
            loading={finishing}
            data-testid="finish-confirm"
            onClick={async () => {
              setFinishing(true)
              await finishPaper({ paper, concepts: p.concepts, markRemainingKnown: markRest })
              setFinishing(false)
              setFinishOpen(false)
            }}
          >
            Mark finished
          </Button>
        </Modal.Footer>
      </Modal>

      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
