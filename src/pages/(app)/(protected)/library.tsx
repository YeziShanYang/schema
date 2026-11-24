/**
 * Library: every paper the reader has opened, with progress, filtered by
 * reading or finished.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Button } from '@/components/ui'
import { useKnowledge, useRoadmaps } from '../../../hooks/useReader'
import type { KnowledgeApi } from '../../../hooks/useReader'
import { arxivSlug } from '../../../lib/arxiv'
import { paperProgress } from '../../../lib/branches'
import type { ConceptData, RoadmapData } from '../../../types'

type Filter = 'all' | 'reading' | 'finished'

function Row({ r, knowledge }: { r: RecordData<RoadmapData>; knowledge: KnowledgeApi }) {
  const concepts = useQuery<ConceptData>('concepts', { where: { paperId: r.data.paperId }, limit: 200 })
  const p = paperProgress(concepts.records.map((c) => c.data), knowledge.statusOf)
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm" data-testid="library-row" data-status={r.data.status}>
      <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="underline">{r.data.title || r.data.arxivId}</Link>
      <span className="text-xs text-muted-foreground">
        {p.known}/{p.total} known · {r.data.status}
        {r.data.lastOpenedAt ? ` · opened ${new Date(r.data.lastOpenedAt).toLocaleDateString()}` : ''}
      </span>
    </li>
  )
}

export default function LibraryPage() {
  const roadmaps = useRoadmaps()
  const knowledge = useKnowledge()
  const [filter, setFilter] = useState<Filter>('all')
  const rows = roadmaps.rows.filter((r) => filter === 'all' || r.data.status === filter)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" data-testid="library-page">
      <h1 className="text-2xl font-semibold">Your papers</h1>
      <div className="flex gap-2">
        {(['all', 'reading', 'finished'] as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'reading' ? 'In progress' : 'Finished'}
          </Button>
        ))}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => <Row key={r.recordId} r={r} knowledge={knowledge} />)}
        {rows.length === 0 && <li className="text-sm text-muted-foreground">No papers here yet.</li>}
      </ul>
    </div>
  )
}
