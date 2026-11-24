/**
 * Library: every paper the reader has opened, with progress and last opened,
 * filtered by in progress or finished; finished papers can be read again.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { Chip, Meter, PageHeader } from '../../../components/blueprint'
import { useKnowledge, useRoadmaps } from '../../../hooks/useReader'
import { arxivSlug } from '../../../lib/arxiv'
import type { PaperData } from '../../../types'

type Filter = 'all' | 'reading' | 'finished'

export default function LibraryPage() {
  const roadmaps = useRoadmaps()
  const knowledge = useKnowledge()
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const paperById = useMemo(() => new Map(papers.records.map((p) => [p.recordId, p])), [papers.records])
  const [filter, setFilter] = useState<Filter>('all')
  const rows = roadmaps.rows.filter((r) => filter === 'all' || r.data.status === filter)

  return (
    <div className="min-h-full" data-testid="library-page">
      <PageHeader label="Library" title="Your papers" />
      <div className="mx-auto grid max-w-4xl gap-4 px-5 py-6 md:px-7">
        <div className="flex gap-1 self-start rounded bg-surface-2 p-[3px] shadow-[inset_0_0_0_1px_var(--color-border)]" role="group" aria-label="Filter papers">
          {(['all', 'reading', 'finished'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn('press cursor-pointer rounded-[3px] px-3 py-1 text-sm font-medium', filter === f ? 'bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
            >
              {f === 'all' ? 'All' : f === 'reading' ? 'In progress' : 'Finished'}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="surface p-5 text-sm text-muted-foreground">No papers here yet. Papers you open are saved here automatically.</p>
        ) : (
          <ul className="surface divide-y divide-border">
            {rows.map((r) => {
              const paper = paperById.get(r.data.paperId)
              const keys = paper?.data.topicKeys ?? []
              const known = keys.filter((k) => knowledge.statusOf(k) === 'known').length
              const total = keys.length || paper?.data.conceptCount || 0
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
                    <div className="mb-1 flex justify-between tabular-nums"><span>Known</span><b className="font-semibold text-foreground">{known} / {total}</b></div>
                    <Meter value={total ? known / total : 0} />
                  </div>
                  <div>
                    {r.data.status === 'finished' ? (
                      <Button size="sm" variant="outline" onClick={() => roadmaps.setStatus(r.data.paperId, 'reading')} data-testid="library-read-again">Read again</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => roadmaps.setStatus(r.data.paperId, 'finished')}>Mark finished</Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
