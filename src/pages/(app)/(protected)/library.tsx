/**
 * Library: every paper the reader has opened, with progress and last opened,
 * filtered by in progress or finished; finished papers can be read again,
 * and a failed analysis can be retried from its row.
 * Finishing and reading again go through the same hooks and dialog as the
 * paper window, so the paper's workspace entries follow, and Read again
 * offers to uncheck what finishing checked.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Chip, Meter, PageHeader } from '../../../components/blueprint'
import { FinishDialog, ReadAgainButton } from '../../../components/paper/FinishDialog'
import { checkedPerPaper, useConceptKnowledge, useRoadmaps } from '../../../hooks/useReader'
import { useRetryPaper } from '../../../hooks/useRetryPaper'
import { arxivSlug } from '../../../lib/arxiv'
import type { PaperData, RoadmapData } from '../../../types'

type Filter = 'all' | 'reading' | 'finished'

const EMPTY: Record<Filter, string> = {
  all: 'No papers here yet. Papers you open are saved here automatically.',
  reading: 'No papers in progress. A paper you open is listed here until you mark it finished.',
  finished: 'No finished papers yet. Papers you mark finished are listed here.',
}

export default function LibraryPage() {
  const roadmaps = useRoadmaps()
  const knowledge = useConceptKnowledge()
  const checked = useMemo(() => checkedPerPaper(knowledge.rows), [knowledge.rows])
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const paperById = useMemo(() => new Map(papers.records.map((p) => [p.recordId, p])), [papers.records])
  // Counts show once the papers (their concept counts) and the reader's checkmarks are in; until then "…", not "0 / 0".
  const countsReady = papers.status === 'ready' && knowledge.status === 'ready'
  const [filter, setFilter] = useState<Filter>('all')
  const [finishing, setFinishing] = useState<RecordData<PaperData> | null>(null)
  const rows = roadmaps.rows.filter((r) => filter === 'all' || r.data.status === filter)

  return (
    <div className="min-h-full" data-testid="library-page">
      <PageHeader title="Your papers" />
      <div className="grid max-w-4xl gap-4 px-5 py-6 md:px-7">
        <div className="flex w-fit gap-1 rounded-[7px] border border-border bg-surface-2 p-[3px]" role="group" aria-label="Filter papers">
          {(['all', 'reading', 'finished'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn('press cursor-pointer rounded-[3px] border border-transparent px-3 py-1 text-sm font-medium', filter === f ? 'border-transparent bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
            >
              {f === 'all' ? 'All' : f === 'reading' ? 'In progress' : 'Finished'}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="surface p-5 text-sm text-muted-foreground" data-testid="library-empty">{EMPTY[filter]}</p>
        ) : (
          <ul className="surface divide-y divide-border">
            {rows.map((r) => {
              const paper = paperById.get(r.data.paperId)
              const total = paper?.data.conceptCount || 0
              return (
                <LibraryRow
                  key={r.recordId}
                  row={r}
                  paper={paper}
                  total={total}
                  known={Math.min(checked.get(r.data.paperId) ?? 0, total)}
                  countsReady={countsReady}
                  onFinish={() => setFinishing(paper ?? null)}
                />
              )
            })}
          </ul>
        )}
      </div>
      <FinishDialog paper={finishing} open={!!finishing} onClose={() => setFinishing(null)} />
    </div>
  )
}

/**
 * One paper. A failed analysis is not a readable paper: it shows the failure
 * and Retry (the paper window's retry path) in place of the counts and Mark
 * finished. A paper being analyzed says so until it is ready.
 */
function LibraryRow({
  row: r,
  paper,
  total,
  known,
  countsReady,
  onFinish,
}: {
  row: RecordData<RoadmapData>
  paper: RecordData<PaperData> | undefined
  total: number
  known: number
  countsReady: boolean
  onFinish: () => void
}) {
  const status = paper?.data.status
  const failed = status === 'failed'
  const analyzing = status === 'queued' || status === 'processing'
  const { retry, retrying, error } = useRetryPaper(paper?.recordId)
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_7rem] md:items-center" data-testid="library-row" data-status={r.data.status} data-paper-status={status ?? ''}>
      <div className="min-w-0">
        <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="font-medium hover:text-primary">{r.data.title || r.data.arxivId}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">arXiv {r.data.arxivId}</span>
          {r.data.lastOpenedAt ? <span>Opened {new Date(r.data.lastOpenedAt).toLocaleDateString()}</span> : null}
          {r.data.status === 'finished' && <Chip tone="known">Finished</Chip>}
        </div>
      </div>
      {failed ? (
        <div className="text-xs" data-testid="library-failed">
          <span className="text-learning">Analysis failed</span>
          {error && <p role="alert" className="mt-0.5 text-destructive">{error}</p>}
        </div>
      ) : analyzing ? (
        <div className="text-xs text-primary" data-testid="library-analyzing">Analyzing…</div>
      ) : (
        <div className="text-xs text-muted-foreground">
          <div className="mb-1 flex justify-between tabular-nums" data-testid="library-known">
            <span>Concepts known</span>
            <b className="font-semibold text-foreground">{countsReady ? `${known} / ${total}` : '…'}</b>
          </div>
          <Meter value={total ? known / total : 0} />
        </div>
      )}
      <div>
        {failed ? (
          <Button size="sm" variant="outline" loading={retrying} onClick={retry} data-testid="library-retry">Retry</Button>
        ) : analyzing ? null : r.data.status === 'finished' ? (
          <ReadAgainButton paperId={r.data.paperId} size="sm" variant="outline" testId="library-read-again" />
        ) : (
          <Button size="sm" variant="ghost" disabled={!paper} onClick={onFinish} data-testid="library-finish">Mark finished</Button>
        )}
      </div>
    </li>
  )
}
