/**
 * Paper page (readable signed out). Its final layout is being designed
 * separately; this version drives every paper flow over usePaper: analysis
 * progress and retry, branches with known/total, the selected branch's
 * concepts by tier, lazy explainer links per branch, the walkthrough and
 * "mark finished". Signed out it runs in demo mode: status changes stay in
 * memory and a banner says so.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button, Checkbox, Label } from '@/components/ui'
import { cn } from '@/lib/utils'
import { arxivAbsUrl, arxivFromSlug, parseArxivId } from '../../../lib/arxiv'
import { usePaper, useFinishPaper } from '../../../hooks/usePaper'
import { useReaderKnowledge } from '../../../hooks/useDemoKnowledge'
import { useRoadmaps } from '../../../hooks/useReader'
import { useAllowance } from '../../../hooks/useAllowance'
import { ConceptCard } from '../../../components/paper/ConceptCard'
import { AnalyzeForm } from '../../../components/AnalyzeForm'
import { Chip, Meter } from '../../../components/blueprint'
import { LinkIcon } from '../../../components/icons'
import { actions } from '../../../lib/actions-client'

const STAGES = ['queued', 'text', 'concepts', 'explain', 'ready'] as const

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

export default function PaperPage() {
  const { arxivId: slug = '' } = useParams()
  const arxivId = arxivFromSlug(slug)
  const { isSignedIn } = useAuth()
  const knowledge = useReaderKnowledge()
  const p = usePaper(arxivId, knowledge)
  const roadmaps = useRoadmaps()
  const finishPaper = useFinishPaper()
  const { allowance } = useAllowance()
  const prefKey = `schema:branch:${arxivId}`
  const [branch, setBranch] = useState<string>(() => readPref(prefKey))
  const [view, setView] = useState<'branches' | 'walkthrough'>(() => (readPref(`${prefKey}:view`) === 'walkthrough' ? 'walkthrough' : 'branches'))
  const [finishOpen, setFinishOpen] = useState(false)
  const [markRest, setMarkRest] = useState(true)
  const [retryError, setRetryError] = useState('')
  const [linksBusy, setLinksBusy] = useState(false)
  const [linksError, setLinksError] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [pendingFocus, setPendingFocus] = useState('')

  const paper = p.paper
  const roadmap = paper ? roadmaps.byPaper.get(paper.recordId) : undefined

  // Remember this paper in the reader's library, once per visit.
  const touched = useRef('')
  const { touch, ready: roadmapsReady } = roadmaps
  useEffect(() => {
    if (!paper || !isSignedIn || !roadmapsReady || touched.current === paper.recordId) return
    touched.current = paper.recordId
    void touch({ paperId: paper.recordId, arxivId: paper.data.arxivId, title: paper.data.title })
  }, [paper, isSignedIn, roadmapsReady, touch])

  const activeBranch = p.branches.some((b) => b.key === branch) ? branch : (p.branches[0]?.key ?? '')

  // After switching branch to show a concept, scroll it into view.
  useEffect(() => {
    if (!pendingFocus) return
    const el = document.getElementById(`concept-${pendingFocus}`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      setPendingFocus('')
    }
  }, [pendingFocus, activeBranch, view])

  if (!parseArxivId(arxivId)) return <div className="p-6">Not a valid arXiv id.</div>
  if (p.loading) return <div className="p-6 text-muted-foreground">Loading…</div>

  if (!paper) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="paper-missing">
        <h1 className="text-xl font-semibold">arXiv {arxivId} has not been analyzed yet</h1>
        <AnalyzeForm placeholder={arxivId} />
      </div>
    )
  }

  const d = paper.data
  const inProgress = d.status === 'queued' || d.status === 'processing'
  const openConcept = (key: string) => {
    const c = p.conceptByKey.get(key)
    if (!c) return
    setView('branches')
    setBranch(c.data.branchKey)
    writePref(prefKey, c.data.branchKey)
    setPendingFocus(key)
  }
  const links = activeBranch ? p.linksForBranch(activeBranch) : 'ready'

  async function loadLinks() {
    if (!paper) return
    setLinksBusy(true)
    setLinksError('')
    let more = true
    // A big branch can take more than one call; continuing a branch counts once.
    for (let i = 0; more && i < 4; i++) {
      const r = await actions.loadBranchResources(paper.recordId, activeBranch)
      if (!r.success) {
        setLinksError(r.error)
        break
      }
      more = r.data.remaining > 0
    }
    setLinksBusy(false)
  }

  const year = d.publishedAt ? d.publishedAt.slice(0, 4) : ''

  return (
    <div className="min-h-full" data-testid="paper-page" data-paper-status={d.status}>
      {knowledge.isDemo && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent-soft px-5 py-2 text-sm md:px-7" data-testid="demo-banner" role="status">
          <span>Demo: your progress isn't saved. Sign in to keep it.</span>
          <Button size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
        </div>
      )}

      <header className="border-b border-border bg-card px-5 pb-4 pt-5 md:px-7">
        <div className="label">Paper</div>
        <h1 className="mt-0.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] text-balance" data-testid="paper-title">{d.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {d.authors?.slice(0, 6).join(', ')}
          {d.authors?.length > 6 ? ' et al.' : ''}
          {year && ` · ${year}`} ·{' '}
          <a href={arxivAbsUrl(d.arxivId)} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
            arXiv {d.arxivId}
          </a>
        </p>
        {d.mainContribution && <p className="mt-2 max-w-3xl text-sm">{d.mainContribution}</p>}
      </header>

      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-5 md:px-7">
        {inProgress && (
          <section className="surface p-4" data-testid="paper-progress" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Analyzing: {d.progressMessage || d.stage}</span>
              <b className="tabular-nums">{Math.round((d.progress ?? 0) * 100)}%</b>
            </div>
            <Meter value={d.progress ?? 0} tone="primary" className="mt-2" />
            <ol className="mt-2 flex flex-wrap gap-3">
              {STAGES.map((s) => (
                <li key={s} className={cn('label', s === d.stage && 'text-foreground')}>{s}</li>
              ))}
            </ol>
          </section>
        )}

        {d.status === 'failed' && (
          <section className="surface border-destructive p-4" data-testid="paper-failed">
            <p className="text-sm">Analysis failed: {d.error || 'unknown error'}</p>
            <p className="mt-1 text-xs text-muted-foreground">A failed analysis does not use up a daily paper.</p>
            {isSignedIn && (
              <Button className="mt-2" size="sm" onClick={async () => {
                const r = await actions.retryPaper(paper.recordId)
                setRetryError(r.success ? '' : r.error)
              }}>
                Retry
              </Button>
            )}
            {retryError && <p className="mt-1 text-sm text-destructive">{retryError}</p>}
          </section>
        )}

        {p.concepts.length > 0 && (
          <>
            <section className="flex flex-wrap items-center gap-3 text-sm">
              <div className="min-w-[220px] flex-1">
                <div className="mb-1 flex justify-between text-[12.5px] text-muted-foreground" data-testid="paper-progress-count">
                  <span>{knowledge.isDemo ? 'Concepts known (demo)' : 'Concepts known'}</span>
                  <b className="font-semibold text-foreground tabular-nums">{p.progress.known} / {p.progress.total}</b>
                </div>
                <Meter value={p.progress.ratio} />
              </div>
              {roadmap?.data.status === 'finished' ? (
                <span className="flex items-center gap-2">
                  <Chip tone="known"><span data-testid="paper-finished">Finished</span></Chip>
                  <Button size="sm" variant="ghost" onClick={() => roadmaps.setStatus(paper.recordId, 'reading')} data-testid="read-again">Read again</Button>
                </span>
              ) : isSignedIn && d.status === 'ready' ? (
                <Button size="sm" variant="outline" onClick={() => setFinishOpen((v) => !v)} data-testid="finish-toggle">Mark finished</Button>
              ) : null}
            </section>

            {finishOpen && (
              <section className="surface p-4" data-testid="finish-panel">
                <div className="flex items-center gap-2">
                  <Checkbox id="mark-rest" checked={markRest} onCheckedChange={setMarkRest} />
                  <Label htmlFor="mark-rest">Also mark the remaining topics in this paper as known</Label>
                </div>
                <Button className="mt-3" size="sm" data-testid="finish-confirm" onClick={async () => {
                  await finishPaper({ paper, concepts: p.concepts, markRemainingKnown: markRest })
                  setFinishOpen(false)
                }}>
                  Confirm
                </Button>
              </section>
            )}

            <nav className="flex gap-1 rounded bg-surface-2 p-[3px] shadow-[inset_0_0_0_1px_var(--color-border)] self-start" aria-label="Paper view">
              {(['branches', 'walkthrough'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => { setView(v); writePref(`${prefKey}:view`, v) }}
                  data-testid={v === 'walkthrough' ? 'view-walkthrough' : 'view-branches'}
                  className={cn('press cursor-pointer rounded-[3px] px-3 py-1 text-sm font-medium', view === v ? 'bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
                >
                  {v === 'branches' ? 'Branches' : 'Walkthrough'}
                </button>
              ))}
            </nav>

            {view === 'branches' ? (
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <ul className="grid gap-2 self-start" data-testid="branch-list">
                  {p.branches.map((b) => (
                    <li key={b.key}>
                      <button
                        type="button"
                        onClick={() => { setBranch(b.key); writePref(prefKey, b.key) }}
                        aria-pressed={b.key === activeBranch}
                        className={cn(
                          'press w-full cursor-pointer rounded border border-transparent bg-card p-3 text-left',
                          b.key === activeBranch ? 'shadow-[0_0_0_2px_var(--color-primary),var(--shadow-ring-hi)]' : 'shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)]',
                        )}
                        data-testid="branch"
                        data-branch-key={b.key}
                      >
                        <span className="mb-1.5 block text-sm font-semibold">{b.name}</span>
                        <span className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                          <span data-testid="branch-progress">{b.known}/{b.total}</span>
                          {b.total > 0 && b.known === b.total && <span className="font-semibold text-known">Done</span>}
                        </span>
                        <Meter value={b.total ? b.known / b.total : 0} />
                      </button>
                    </li>
                  ))}
                </ul>

                <section className="surface min-w-0" aria-label="Branch concepts">
                  {(() => {
                    const b = p.branches.find((x) => x.key === activeBranch)
                    if (!b) return null
                    return (
                      <div className="border-b border-border px-4 pb-3 pt-4">
                        <div className="label">{b.known} of {b.total} known</div>
                        <h2 className="mt-1 text-[21px] font-semibold">{b.name}</h2>
                        <p className="mt-1 text-[13px] text-muted-foreground">{b.description}</p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="branch-links" data-links={links}>
                          {links === 'needs-load' &&
                            (isSignedIn ? (
                              <Button size="sm" variant="outline" loading={linksBusy} onClick={loadLinks} data-testid="load-links">
                                <LinkIcon size={14} /> Load explainer links
                                {allowance && <span className="font-normal text-faint tabular-nums">· {allowance.branch.remaining} loads left today</span>}
                              </Button>
                            ) : (
                              <span className="text-[13px] text-muted-foreground" data-testid="links-signin">
                                <button type="button" className="text-primary hover:underline" onClick={() => setShowAuth(true)}>Sign in</button> to load explainer links for this branch.
                              </span>
                            ))}
                          {links === 'loading' && <span className="text-[13px] text-muted-foreground">Finding explainers…</span>}
                          {linksError && <span role="alert" className="text-[13px] text-destructive">{linksError}</span>}
                        </div>
                      </div>
                    )
                  })()}
                  <ul className="max-h-none px-3 pb-4" data-testid="branch-concepts">
                    {p.conceptsInBranch(activeBranch).map((c) => (
                      <ConceptCard
                        key={c.recordId}
                        concept={c}
                        paper={paper}
                        topic={p.topicsByKey.get(c.data.topicKey)?.data}
                        prerequisites={(c.data.dependsOn ?? []).map((k) => ({ key: k, name: p.conceptByKey.get(k)?.data.name ?? k }))}
                        onOpenConcept={openConcept}
                        status={knowledge.statusOf(c.data.topicKey)}
                        knowledge={knowledge}
                        signedIn={!!isSignedIn}
                        explainLeft={allowance?.explain.remaining}
                      />
                    ))}
                  </ul>
                </section>
              </div>
            ) : (
              <ol className="grid gap-3" data-testid="walkthrough">
                {p.sections.map((s) => (
                  <li key={s.recordId} className="surface p-4">
                    <h3 className="font-semibold">{s.data.heading}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.data.summary}</p>
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {(s.data.conceptKeys ?? []).map((k) => {
                        const c = p.conceptByKey.get(k)
                        if (!c) return null
                        return (
                          <button key={k} type="button" data-testid="walkthrough-chip" onClick={() => openConcept(k)}
                            className="press cursor-pointer rounded-[3px] bg-surface-2 px-2 py-0.5 text-xs shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-accent-soft">
                            {c.data.name}
                          </button>
                        )
                      })}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        <p className="text-sm">
          <Link to="/home" className="text-primary hover:underline">Back to home</Link>
        </p>
      </div>
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
