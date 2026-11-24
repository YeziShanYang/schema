/**
 * Home: workspaces, paste a link, continue where you left off, and recently
 * analyzed papers. Minimal functional UI over the data hooks.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Button, Input, Textarea } from '@/components/ui'
import { AnalyzeForm } from '../../components/AnalyzeForm'
import { useRoadmaps } from '../../hooks/useReader'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { arxivSlug } from '../../lib/arxiv'
import { capState, DAILY_PAPER_CAP } from '../../lib/cap'
import type { PaperData } from '../../types'

export default function HomePage() {
  const { isSignedIn, userId } = useAuth()
  const workspaces = useWorkspaces()
  const roadmaps = useRoadmaps()
  const navigate = useNavigate()
  const recentReady = useQuery<PaperData>('papers', { where: { status: 'ready' }, orderBy: 'updatedAt', orderDir: 'desc', limit: 10 })
  const mine = useQuery<PaperData>('papers', { where: { requestedBy: userId ?? '__none__' }, limit: 50 })
  const cap = capState(mine.records.map((r) => r.createdAt), Date.now())

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  async function createWorkspace(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const id = await workspaces.create(name, description)
      if (id) navigate(`/w/${id}`)
    } finally {
      setCreating(false)
    }
  }

  const continuePaper = roadmaps.rows.find((r) => r.data.status === 'reading')

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6" data-testid="home-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Schema</h1>
        <p className="text-sm text-muted-foreground">
          Paste an arXiv paper to get the concepts it relies on, grouped into branches and ordered by prerequisite.
        </p>
        <AnalyzeForm />
        {isSignedIn && (
          <p className="text-xs text-muted-foreground" data-testid="cap-remaining">
            {cap.remaining} of {DAILY_PAPER_CAP} new papers left in the last 24 hours. Papers already analyzed are free.
          </p>
        )}
      </section>

      {isSignedIn && continuePaper && (
        <section data-testid="continue">
          <h2 className="text-lg font-semibold">Continue where you left off</h2>
          <Link to={`/p/${arxivSlug(continuePaper.data.arxivId)}`} className="text-primary underline">
            {continuePaper.data.title || continuePaper.data.arxivId}
          </Link>
        </section>
      )}

      {isSignedIn && (
        <section className="space-y-3" data-testid="workspaces">
          <h2 className="text-lg font-semibold">Workspaces</h2>
          <ul className="space-y-1">
            {workspaces.rows.map((w) => (
              <li key={w.recordId}>
                <Link to={`/w/${w.recordId}`} className="text-primary underline" data-testid="workspace-link">
                  {w.data.name}
                </Link>{' '}
                <span className="text-xs text-muted-foreground">{w.data.papers?.length ?? 0} papers</span>
              </li>
            ))}
            {workspaces.rows.length === 0 && <li className="text-sm text-muted-foreground">No workspaces yet.</li>}
          </ul>
          <form onSubmit={createWorkspace} className="space-y-2 rounded-lg border border-border bg-card p-4" data-testid="workspace-form">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name, e.g. CS 229" aria-label="Workspace name" />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What do you want to learn? (optional)" aria-label="Workspace description" />
            <Button type="submit" size="sm" loading={creating} disabled={!workspaces.ready}>
              Create workspace
            </Button>
          </form>
        </section>
      )}

      {isSignedIn && roadmaps.rows.length > 0 && (
        <section data-testid="recent-papers">
          <h2 className="text-lg font-semibold">Your recent papers</h2>
          <ul className="space-y-1 text-sm">
            {roadmaps.rows.slice(0, 8).map((r) => (
              <li key={r.recordId}>
                <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="underline">{r.data.title || r.data.arxivId}</Link>{' '}
                <span className="text-xs text-muted-foreground">{r.data.status}</span>
              </li>
            ))}
          </ul>
          <Link to="/library" className="text-sm text-primary underline">All papers</Link>
        </section>
      )}

      <section data-testid="recently-analyzed">
        <h2 className="text-lg font-semibold">Recently analyzed</h2>
        <ul className="space-y-1 text-sm">
          {recentReady.records.map((r) => (
            <li key={r.recordId}>
              <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="underline">{r.data.title}</Link>{' '}
              <span className="text-xs text-muted-foreground">{r.data.conceptCount} concepts</span>
            </li>
          ))}
          {recentReady.records.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  )
}
