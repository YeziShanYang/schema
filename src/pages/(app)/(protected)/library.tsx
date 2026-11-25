/**
 * Library: every paper the reader has opened, with progress and last opened,
 * filtered by in progress or finished; finished papers can be read again.
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
import { arxivSlug } from '../../../lib/arxiv'
import type { PaperData } from '../../../types'

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
      <PageHeader label="Library" title="Your papers" />
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
              const known = Math.min(checked.get(r.data.paperId) ?? 0, total)
              return (
                <li key={r.recordId} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center" data-testid="library-row" data-status={r.data.status}>
                  <div className="min-w-0">
                    <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="font-medium hover:text-primary">{r.data.title || r.data.arxivId}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">arXiv {r.data.arxivId}</span>
                      {r.data.lastOpenedAt ? <span>Opened {new Date(r.data.lastOpenedAt).toLocaleDateString()}</span> : null}
                      {r.data.status === 'finished' && <Chip tone="known">Finished</Chip>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="mb-1 flex justify-between tabular-nums" data-testid="library-known">
                      <span>Concepts known</span>
                      <b className="font-semibold text-foreground">{countsReady ? `${known} / ${total}` : '…'}</b>
                    </div>
                    <Meter value={total ? known / total : 0} />
                  </div>
                  <div>
                    {r.data.status === 'finished' ? (
                      <ReadAgainButton paperId={r.data.paperId} size="sm" variant="outline" testId="library-read-again" />
                    ) : (
                      <Button size="sm" variant="ghost" disabled={!paper} onClick={() => setFinishing(paper ?? null)} data-testid="library-finish">Mark finished</Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <FinishDialog paper={finishing} open={!!finishing} onClose={() => setFinishing(null)} />
    </div>
  )
}
