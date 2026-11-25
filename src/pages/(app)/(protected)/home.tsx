/**
 * Home: continue where you left off, paste an arXiv link, recently analyzed
 * papers. Requires sign-in (it sits under (protected)).
 */

import { Link } from 'react-router-dom'
import { plural } from '@/lib/utils'
import { useQuery } from 'deepspace'
import { AnalyzeForm } from '../../../components/AnalyzeForm'
import { AddButton } from '../../../components/AddDialog'
import { FirstRunPrompt } from '../../../components/FirstRunPrompt'
import { PageHeader } from '../../../components/blueprint'
import { useRoadmaps } from '../../../hooks/useReader'
import { useWorkspaces } from '../../../hooks/useWorkspaces'
import { arxivSlug } from '../../../lib/arxiv'
import type { PaperData } from '../../../types'

export default function HomePage() {
  const workspaces = useWorkspaces()
  const roadmaps = useRoadmaps()
  const recentReady = useQuery<PaperData>('papers', { where: { status: 'ready' }, orderBy: 'updatedAt', orderDir: 'desc', limit: 10 })

  const lastWorkspace = workspaces.rows[0]
  const lastPaper = roadmaps.rows[0]

  return (
    <div className="min-h-full" data-testid="home-page">
      <PageHeader label="Home" title="Learn the ideas a paper is built on">
        <AddButton testId="home-add-open" />
      </PageHeader>
      <div className="grid max-w-5xl grid-cols-1 gap-5 px-5 py-6 md:px-7">
        <FirstRunPrompt />
        {(lastWorkspace || lastPaper) && (
          <section className="surface enter p-4" style={{ ['--i' as string]: 0 }} data-testid="continue">
            <div className="label">Continue where you left off</div>
            {lastWorkspace ? (
              <Link to={`/w/${lastWorkspace.recordId}`} className="mt-1 block text-lg font-semibold text-foreground hover:text-primary">
                {lastWorkspace.data.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {plural(workspaces.papersOf(lastWorkspace.recordId).length, 'paper', 'papers')}
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
          <div className="label">Open a paper without a workspace</div>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Paste an arXiv link or id. A paper nobody has analyzed takes about two minutes; one already analyzed opens right away.
          </p>
          <AnalyzeForm />
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
