/**
 * Knowledge profile: every topic the reader knows or is learning, grouped by
 * level, with its source and the paper it came from; search to add any topic
 * in the shared vocabulary; the starter list for new readers.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Input } from '@/components/ui'
import { Chip, PageHeader } from '../../../components/blueprint'
import { StatusControl } from '../../../components/StatusControl'
import { useKnowledge, useTopics } from '../../../hooks/useReader'
import { actions } from '../../../lib/actions-client'
import { arxivSlug } from '../../../lib/arxiv'
import { STARTER_TOPICS } from '../../../lib/topics'
import type { KnowledgeData, KnowledgeStatus, PaperData, TopicLevel } from '../../../types'

const LEVELS: TopicLevel[] = ['foundation', 'core', 'specialized']
const SOURCE: Record<string, string> = { self: 'Marked by you', paper: 'While reading', check: 'Passed the check in', finished: 'Finished' }

export default function KnowledgePage() {
  const knowledge = useKnowledge()
  const { topics, byKey, status: topicsStatus } = useTopics()
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const paperById = useMemo(() => new Map(papers.records.map((p) => [p.recordId, p])), [papers.records])
  const [q, setQ] = useState('')

  // Make sure the starter topics exist (idempotent, batched on the server).
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || topicsStatus !== 'ready') return
    if (STARTER_TOPICS.every((t) => byKey.has(t.key))) return
    seeded.current = true
    void (async () => {
      for (let i = 0; i < 4; i++) {
        const r = await actions.seedTopics()
        if (!r.success || r.data.remaining === 0) break
      }
    })()
  }, [topicsStatus, byKey])

  const rows = knowledge.rows
  const known = rows.filter((r) => r.data.status === 'known')
  const learning = rows.filter((r) => r.data.status === 'learning')
  const starters = STARTER_TOPICS.filter((t) => !knowledge.byTopic.has(t.key) && byKey.has(t.key))
  const matches = q.trim()
    ? topics.filter((t) => !knowledge.byTopic.has(t.data.key) && t.data.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20)
    : []

  const setStatus = (topicKey: string) => (next: KnowledgeStatus | null) =>
    next === null ? knowledge.clear(topicKey) : knowledge.set(topicKey, next, 'self')

  function source(r: RecordData<KnowledgeData>) {
    const p = r.data.paperId ? paperById.get(r.data.paperId) : undefined
    const label = SOURCE[r.data.source] ?? ''
    if (!p || r.data.source === 'self') return <span className="text-xs text-faint">{label}</span>
    return (
      <span className="text-xs text-faint">
        {label}{' '}
        <Link to={`/p/${arxivSlug(p.data.arxivId)}`} className="text-muted-foreground hover:text-primary hover:underline">{p.data.title}</Link>
      </span>
    )
  }

  function section(title: string, items: RecordData<KnowledgeData>[], testId: string) {
    const groups = LEVELS.map((level) => ({ level, items: items.filter((r) => (byKey.get(r.data.topicKey)?.data.level ?? 'core') === level) })).filter((g) => g.items.length)
    return (
      <section data-testid={testId}>
        <div className="label pb-2">{title} · <span className="tabular-nums">{items.length}</span></div>
        {items.length === 0 ? (
          <p className="surface p-4 text-sm text-muted-foreground">{title === 'Known' ? 'Nothing marked known yet.' : 'Nothing in progress.'}</p>
        ) : (
          <div className="surface divide-y divide-border">
            {groups.map((g) => (
              <div key={g.level} className="px-4 py-3">
                <div className="label pb-1.5 text-faint">{g.level}</div>
                <ul className="flex flex-col">
                  {g.items.map((r) => {
                    const t = byKey.get(r.data.topicKey)?.data
                    return (
                      <li key={r.recordId} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2" data-testid="knowledge-item" data-topic-key={r.data.topicKey}>
                        <div className="min-w-0">
                          <p className="font-medium leading-snug">{t?.name ?? r.data.topicKey}</p>
                          {t?.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{t.description}</p>}
                          <p className="mt-0.5">{source(r)}</p>
                        </div>
                        <StatusControl status={r.data.status} name={t?.name ?? r.data.topicKey} disabled={!knowledge.ready} onChange={setStatus(r.data.topicKey)} />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="min-h-full" data-testid="knowledge-page">
      <PageHeader label="Knowledge" title="What you know" />
      <div className="grid max-w-4xl gap-6 px-5 py-6 md:px-7">
        <p className="-mt-1 text-sm text-muted-foreground">
          Topics are shared across papers. A topic you mark here shows as known in every paper that relies on it.
        </p>
        {section('Learning', learning, 'knowledge-learning')}
        {section('Known', known, 'knowledge-known')}

        <section className="surface p-4">
          <div className="label pb-2">Add a topic</div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every topic, e.g. softmax" aria-label="Search topics" data-testid="topic-search" />
          {matches.length > 0 && (
            <ul className="mt-2 divide-y divide-border">
              {matches.map((t) => (
                <li key={t.recordId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{t.data.name}</span> <Chip className="ml-1">{t.data.level}</Chip>
                  </span>
                  <StatusControl status={null} name={t.data.name} disabled={!knowledge.ready} onChange={setStatus(t.data.key)} />
                </li>
              ))}
            </ul>
          )}
          {q.trim() && matches.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No topic matches “{q.trim()}”.</p>}
        </section>

        {starters.length > 0 && (
          <section data-testid="starter-topics">
            <div className="label pb-1">Common starting points</div>
            <p className="pb-2 text-sm text-muted-foreground">Tick what you already know, so new papers skip it.</p>
            <ul className="flex flex-wrap gap-2">
              {starters.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    disabled={!knowledge.ready}
                    onClick={() => knowledge.set(t.key, 'known', 'self')}
                    data-testid="starter-topic"
                    className="press cursor-pointer rounded bg-card px-2.5 py-1 text-[13px] shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)] disabled:cursor-not-allowed disabled:opacity-50 border border-transparent"
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
