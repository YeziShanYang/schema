/**
 * Home: continue where you left off, paste an arXiv link, recently analyzed
 * papers. Signed out, it points to the demo paper.
 */

import { Link } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { AnalyzeForm } from '../../components/AnalyzeForm'
import { PageHeader } from '../../components/blueprint'
import { useRoadmaps } from '../../hooks/useReader'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { arxivSlug } from '../../lib/arxiv'
import { DEMO_ARXIV_ID } from '../../constants'
import type { PaperData } from '../../types'

export default function HomePage() {
  const { isSignedIn } = useAuth()
  const workspaces = useWorkspaces()
  const roadmaps = useRoadmaps()
  const recentReady = useQuery<PaperData>('papers', { where: { status: 'ready' }, orderBy: 'updatedAt', orderDir: 'desc', limit: 10 })

  const lastWorkspace = workspaces.rows[0]
  const lastPaper = roadmaps.rows[0]

  return (
    <div className="min-h-full" data-testid="home-page">
      <PageHeader label="Home" title="Learn the ideas a paper is built on" />
      <div className="grid max-w-5xl gap-5 px-5 py-6 md:px-7">
        {isSignedIn && (lastWorkspace || lastPaper) && (
          <section className="surface enter p-4" style={{ ['--i' as string]: 0 }} data-testid="continue">
            <div className="label">Continue where you left off</div>
            {lastWorkspace ? (
              <Link to={`/w/${lastWorkspace.recordId}`} className="mt-1 block text-lg font-semibold text-foreground hover:text-primary">
                {lastWorkspace.data.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {lastWorkspace.data.papers?.length ?? 0} papers
                </span>
              </Link>
            ) : (
              <Link to={`/p/${arxivSlug(lastPaper.data.arxivId)}`} className="mt-1 block text-lg font-semibold text-foreground hover:text-primary">
                {lastPaper.data.title}
              </Link>
            )}
            {lastWorkspace && lastPaper && (
              <p className="mt-1 text-sm text-muted-foreground">
                Last paper:{' '}
                <Link className="text-primary hover:underline" to={`/p/${arxivSlug(lastPaper.data.arxivId)}`}>{lastPaper.data.title}</Link>
              </p>
            )}
          </section>
        )}

        <section className="surface enter p-4" style={{ ['--i' as string]: 1 }}>
          <div className="label">Open a paper</div>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Paste an arXiv link or id. A paper nobody has analyzed takes about two minutes; one already analyzed opens right away.
          </p>
          <AnalyzeForm />
          {!isSignedIn && (
            <p className="mt-3 text-sm text-muted-foreground">
              Or open the{' '}
              <Link to={`/p/${arxivSlug(DEMO_ARXIV_ID)}`} className="text-primary hover:underline" data-testid="home-demo-link">
                demo paper
              </Link>{' '}
              without signing in.
            </p>
          )}
        </section>

        <section className="enter" style={{ ['--i' as string]: 2 }} data-testid="recently-analyzed">
          <div className="label pb-2">Recently analyzed</div>
          {recentReady.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="surface divide-y divide-border">
              {recentReady.records.map((r) => (
                <li key={r.recordId}>
                  <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0 truncate font-medium">{r.data.title}</span>
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.05em] text-muted-foreground tabular-nums">
                      {r.data.conceptCount} concepts · {r.data.arxivId}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
