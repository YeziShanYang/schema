/**
 * The workspace page's list view: the papers and recommendations its graph
 * shows, as rows. Papers come first, those not finished before finished
 * ones, each most recently opened first (listOrder in lib/workspace). A
 * paper row links to the paper and shows its progress, or its analysis
 * state in the graph card's words. Recommendations follow, each with Add
 * and the dismiss button. Rows carry the graph nodes' test ids, so the same
 * selectors work in both views. The meta helpers here also label the graph's
 * cards.
 */

import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { Chip, Meter } from './blueprint'
import { DismissSuggestionButton } from './graph/nodes'
import { PlusIcon } from './icons'
import { arxivSlug } from '../lib/arxiv'
import type { WorkspacePaperNode } from '../hooks/useWorkspaceGraph'
import type { Suggestion } from '../types'

/** Year and arXiv id, as "2017 · arXiv 1706.03762". */
export function paperMeta(p: WorkspacePaperNode): string {
  const year = p.paper?.data.publishedAt?.slice(0, 4) ?? ''
  return year ? `${year} · arXiv ${p.arxivId}` : `arXiv ${p.arxivId}`
}

/** First author's surname and arXiv id, as "Vaswani et al. · arXiv 1706.03762". */
export function suggestionMeta(s: Suggestion): string {
  const author = s.authors?.[0]?.split(' ').slice(-1)[0] ?? ''
  const who = author && (s.authors?.length ?? 0) > 1 ? `${author} et al.` : author
  return who ? `${who} · arXiv ${s.arxivId}` : `arXiv ${s.arxivId}`
}

/** "Analyzing · 40%" while the paper is queued or being analyzed. */
export function analyzingText(p: WorkspacePaperNode): string | undefined {
  return p.analysis === 'queued' || p.analysis === 'processing' ? `Analyzing · ${Math.round(p.analysisProgress * 100)}%` : undefined
}

export function WorkspaceList({
  workspaceId,
  papers,
  candidates,
  loading,
  emptyText,
  adding,
  dismissDisabled,
  onAdd,
  onDismiss,
}: {
  workspaceId: string
  /** Already in list order. */
  papers: WorkspacePaperNode[]
  candidates: Suggestion[]
  /** The workspace's papers are still loading. */
  loading: boolean
  emptyText: string
  /** The arXiv id being added, or ''. */
  adding: string
  dismissDisabled: boolean
  onAdd: (arxivId: string) => void
  onDismiss: (arxivId: string) => void
}) {
  const headingId = useId()
  return (
    <div className="grid max-w-5xl gap-5 px-5 py-6 md:px-7" data-testid="workspace-list">
      {papers.length === 0 && candidates.length === 0 ? (
        <p className="surface p-5 text-sm text-muted-foreground" data-testid="workspace-list-empty">{loading ? 'Loading…' : emptyText}</p>
      ) : (
        <>
          {papers.length > 0 && (
            <section aria-labelledby={`${headingId}-papers`}>
              <h2 id={`${headingId}-papers`} className="label pb-2">Papers</h2>
              <ul className="surface divide-y divide-border">
                {papers.map((p) => (
                  <PaperRow key={p.paperId} paper={p} workspaceId={workspaceId} />
                ))}
              </ul>
            </section>
          )}
          {candidates.length > 0 && (
            <section aria-labelledby={`${headingId}-recommended`}>
              <h2 id={`${headingId}-recommended`} className="label pb-2">Recommended</h2>
              <ul className="surface divide-y divide-border">
                {candidates.map((s) => (
                  <SuggestionRow
                    key={s.arxivId}
                    suggestion={s}
                    busy={adding === s.arxivId}
                    disabled={!!adding && adding !== s.arxivId}
                    dismissDisabled={dismissDisabled || adding === s.arxivId}
                    onAdd={() => onAdd(s.arxivId)}
                    onDismiss={() => onDismiss(s.arxivId)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Title and meta, then the known meter, or the analysis state while there is nothing to count. From 768px they share a line. */
function PaperRow({ paper: p, workspaceId }: { paper: WorkspacePaperNode; workspaceId: string }) {
  const analyzing = analyzingText(p)
  const failed = p.analysis === 'failed'
  return (
    <li
      className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px] md:items-center"
      data-testid="workspace-paper"
      data-arxiv={p.arxivId}
      data-status={p.status}
    >
      <div className="min-w-0">
        <Link to={`/w/${workspaceId}/p/${arxivSlug(p.arxivId)}`} className="break-words font-medium hover:text-primary" data-testid="workspace-paper-title">
          {p.title || p.arxivId}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{paperMeta(p)}</span>
          {p.status === 'finished' && <Chip tone="known">Finished</Chip>}
        </div>
      </div>
      {analyzing ? (
        <div className="text-xs text-primary">{analyzing}</div>
      ) : failed ? (
        <div className="text-xs text-learning">Analysis failed. Open to retry.</div>
      ) : (
        <div className="text-xs text-muted-foreground">
          <div className="mb-1 tabular-nums" data-testid="workspace-paper-progress">
            {p.known} of {p.total} known
          </div>
          <Meter value={p.total ? p.known / p.total : 0} />
        </div>
      )}
    </li>
  )
}

/** Title, meta and reason, with Add and dismiss beside them from 640px and under them below it. */
function SuggestionRow({
  suggestion: s,
  busy,
  disabled,
  dismissDisabled,
  onAdd,
  onDismiss,
}: {
  suggestion: Suggestion
  busy: boolean
  disabled: boolean
  dismissDisabled: boolean
  onAdd: () => void
  onDismiss: () => void
}) {
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-testid="suggestion" data-arxiv={s.arxivId}>
      <div className="min-w-0">
        <div className="break-words font-medium" data-testid="suggestion-title">{s.title}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{suggestionMeta(s)}</div>
        {s.reason && <p className="mt-1 text-[13px] text-muted-foreground">{s.reason}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" loading={busy} disabled={disabled} onClick={onAdd} data-testid="pick-suggestion">
          <PlusIcon size={13} /> Add
        </Button>
        <DismissSuggestionButton title={s.title} disabled={dismissDisabled} onDismiss={onDismiss} />
      </div>
    </li>
  )
}
