/**
 * Paper page (works signed out). Minimal functional UI over usePaper: status
 * and progress, branches with known/total, the selected branch's concepts by
 * tier, the section walkthrough, and "mark finished". The visual design is
 * done separately; keep data access in hooks.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { Button, Checkbox, Label } from '@/components/ui'
import { arxivAbsUrl, arxivFromSlug, parseArxivId } from '../../../lib/arxiv'
import { usePaper, useFinishPaper } from '../../../hooks/usePaper'
import { useRoadmaps } from '../../../hooks/useReader'
import { ConceptCard } from '../../../components/paper/ConceptCard'
import { AnalyzeForm } from '../../../components/AnalyzeForm'
import { actions } from '../../../lib/actions-client'

const STAGES = ['queued', 'text', 'concepts', 'resources', 'explain', 'ready'] as const

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
  const { isSignedIn, userId } = useAuth()
  const p = usePaper(arxivId)
  const roadmaps = useRoadmaps()
  const finishPaper = useFinishPaper()
  const prefKey = `schema:branch:${arxivId}`
  const [branch, setBranch] = useState<string>(() => readPref(prefKey))
  const [view, setView] = useState<'branches' | 'walkthrough'>(() => (readPref(`${prefKey}:view`) === 'walkthrough' ? 'walkthrough' : 'branches'))
  const [finishOpen, setFinishOpen] = useState(false)
  const [markRest, setMarkRest] = useState(true)
  const [retryError, setRetryError] = useState('')

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

  // Default to the first branch once branches exist.
  const activeBranch = p.branches.some((b) => b.key === branch) ? branch : (p.branches[0]?.key ?? '')

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
  const canRetry = isSignedIn && (d.requestedBy === userId) && d.status === 'failed'

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="paper-page" data-paper-status={d.status}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold" data-testid="paper-title">{d.title}</h1>
        <p className="text-sm text-muted-foreground">
          {d.authors?.slice(0, 6).join(', ')}
          {d.authors?.length > 6 ? ' et al.' : ''} ·{' '}
          <a href={arxivAbsUrl(d.arxivId)} target="_blank" rel="noreferrer" className="underline">
            arXiv {d.arxivId}
          </a>
        </p>
        {d.mainContribution && <p className="text-sm">{d.mainContribution}</p>}
      </header>

      {inProgress && (
        <section className="rounded-lg border border-border bg-card p-4" data-testid="paper-progress">
          <p className="text-sm font-medium">Analyzing: {d.progressMessage || d.stage}</p>
          <div className="mt-2 h-2 w-full rounded bg-muted">
            <div className="h-2 rounded bg-primary transition-all" style={{ width: `${Math.round((d.progress ?? 0) * 100)}%` }} />
          </div>
          <ol className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {STAGES.map((s) => (
              <li key={s} className={s === d.stage ? 'font-semibold text-foreground' : ''}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      {d.status === 'failed' && (
        <section className="rounded-lg border border-destructive p-4" data-testid="paper-failed">
          <p className="text-sm">Analysis failed: {d.error || 'unknown error'}</p>
          {canRetry && (
            <Button className="mt-2" size="sm" onClick={async () => {
              const r = await actions.retryPaper(paper.recordId)
              setRetryError(r.success ? '' : r.error)
            }}>
              Retry
            </Button>
          )}
          {retryError && <p className="text-sm text-destructive">{retryError}</p>}
        </section>
      )}

      {p.concepts.length > 0 && (
        <>
          <section className="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid="paper-progress-count">
              {isSignedIn ? `You know ${p.progress.known} of ${p.progress.total} concepts` : `${p.progress.total} concepts`}
            </span>
            {roadmap?.data.status === 'finished' ? (
              <span className="rounded bg-success px-2 py-0.5 text-success-foreground" data-testid="paper-finished">Finished</span>
            ) : isSignedIn && d.status === 'ready' ? (
              <Button size="sm" variant="outline" onClick={() => setFinishOpen((v) => !v)} data-testid="finish-toggle">
                Mark finished
              </Button>
            ) : null}
            {!isSignedIn && <span className="text-muted-foreground">Sign in to track what you know.</span>}
          </section>

          {finishOpen && (
            <section className="rounded-lg border border-border bg-card p-4" data-testid="finish-panel">
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

          <nav className="flex gap-2">
            <Button size="sm" variant={view === 'branches' ? 'default' : 'outline'} onClick={() => { setView('branches'); writePref(`${prefKey}:view`, 'branches') }}>
              Branches
            </Button>
            <Button size="sm" variant={view === 'walkthrough' ? 'default' : 'outline'} onClick={() => { setView('walkthrough'); writePref(`${prefKey}:view`, 'walkthrough') }} data-testid="view-walkthrough">
              Walkthrough
            </Button>
          </nav>

          {view === 'branches' ? (
            <>
              <ul className="grid gap-2 sm:grid-cols-2" data-testid="branch-list">
                {p.branches.map((b) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      onClick={() => { setBranch(b.key); writePref(prefKey, b.key) }}
                      className={`w-full rounded-lg border p-3 text-left ${b.key === activeBranch ? 'border-primary bg-accent' : 'border-border bg-card'}`}
                      data-testid="branch"
                      data-branch-key={b.key}
                    >
                      <span className="font-medium">{b.name}</span>{' '}
                      <span className="text-sm text-muted-foreground" data-testid="branch-progress">
                        {b.known}/{b.total}
                      </span>
                      <span className="block text-xs text-muted-foreground">{b.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="space-y-3" data-testid="branch-concepts">
                {p.conceptsInBranch(activeBranch).map((c) => (
                  <ConceptCard
                    key={c.recordId}
                    concept={c}
                    paper={paper}
                    topic={p.topicsByKey.get(c.data.topicKey)?.data}
                    prerequisites={(c.data.dependsOn ?? []).map((k) => p.conceptByKey.get(k)?.data.name ?? k)}
                    status={p.knowledge.statusOf(c.data.topicKey)}
                    knowledge={p.knowledge}
                    signedIn={isSignedIn}
                  />
                ))}
              </div>
            </>
          ) : (
            <ol className="space-y-4" data-testid="walkthrough">
              {p.sections.map((s) => (
                <li key={s.recordId} className="rounded-lg border border-border bg-card p-4">
                  <h3 className="font-semibold">{s.data.heading}</h3>
                  <p className="mt-1 text-sm">{s.data.summary}</p>
                  <p className="mt-2 flex flex-wrap gap-2 text-xs">
                    {(s.data.conceptKeys ?? []).map((k) => {
                      const c = p.conceptByKey.get(k)
                      if (!c) return null
                      return (
                        <button key={k} type="button" className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                          onClick={() => { setBranch(c.data.branchKey); setView('branches'); writePref(prefKey, c.data.branchKey) }}>
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
        <Link to="/home" className="underline">Back to home</Link>
      </p>
    </div>
  )
}
