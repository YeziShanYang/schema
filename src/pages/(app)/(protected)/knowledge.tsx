/**
 * Knowledge profile: every topic the reader knows or is learning, grouped by
 * level, with the paper each came from; the starter list; and search to add
 * any topic in the shared vocabulary.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Badge, Button, Input } from '@/components/ui'
import { useKnowledge, useTopics } from '../../../hooks/useReader'
import { actions } from '../../../lib/actions-client'
import { arxivSlug } from '../../../lib/arxiv'
import { STARTER_TOPICS } from '../../../lib/topics'
import type { PaperData, TopicLevel } from '../../../types'

const LEVELS: TopicLevel[] = ['foundation', 'core', 'specialized']

export default function KnowledgePage() {
  const knowledge = useKnowledge()
  const { topics, byKey, status: topicsStatus } = useTopics()
  const papers = useQuery<PaperData>('papers', { limit: 1000 })
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
    ? topics
        .filter((t) => !knowledge.byTopic.has(t.data.key) && t.data.name.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 20)
    : []

  function group(list: typeof rows) {
    return LEVELS.map((level) => ({
      level,
      items: list.filter((r) => (byKey.get(r.data.topicKey)?.data.level ?? 'core') === level),
    })).filter((g) => g.items.length > 0)
  }

  function sourceLabel(r: (typeof rows)[number]) {
    const p = r.data.paperId ? paperById.get(r.data.paperId) : undefined
    const via = { self: 'marked by you', paper: 'from', check: 'passed the check in', finished: 'finished' }[r.data.source] ?? ''
    if (!p) return <span className="text-xs text-muted-foreground">{r.data.source === 'self' ? 'marked by you' : via}</span>
    return (
      <span className="text-xs text-muted-foreground">
        {via}{' '}
        <Link to={`/p/${arxivSlug(p.data.arxivId)}`} className="underline">{p.data.title}</Link>
      </span>
    )
  }

  const list = (title: string, items: typeof rows, testId: string) => (
    <section className="space-y-2" data-testid={testId}>
      <h2 className="text-lg font-semibold">{title} ({items.length})</h2>
      {group(items).map((g) => (
        <div key={g.level}>
          <h3 className="text-sm font-medium capitalize text-muted-foreground">{g.level}</h3>
          <ul className="space-y-1">
            {g.items.map((r) => {
              const t = byKey.get(r.data.topicKey)?.data
              return (
                <li key={r.recordId} className="flex flex-wrap items-center gap-2 text-sm" data-testid="knowledge-item" data-topic-key={r.data.topicKey}>
                  <span className="font-medium">{t?.name ?? r.data.topicKey}</span>
                  {sourceLabel(r)}
                  {r.data.status === 'learning' ? (
                    <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.set(r.data.topicKey, 'known', 'self')}>Mark known</Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.set(r.data.topicKey, 'learning', 'self')}>Move to learning</Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.clear(r.data.topicKey)} data-testid="knowledge-remove">Remove</Button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6" data-testid="knowledge-page">
      <h1 className="text-2xl font-semibold">What you know</h1>
      {list('Known', known, 'knowledge-known')}
      {list('Learning', learning, 'knowledge-learning')}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Add a topic</h2>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics" aria-label="Search topics" data-testid="topic-search" />
        <ul className="space-y-1">
          {matches.map((t) => (
            <li key={t.recordId} className="flex items-center gap-2 text-sm">
              <span>{t.data.name}</span>
              <Badge variant="outline">{t.data.level}</Badge>
              <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.set(t.data.key, 'known', 'self')}>I know this</Button>
              <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.set(t.data.key, 'learning', 'self')}>Learning</Button>
            </li>
          ))}
        </ul>
      </section>

      {starters.length > 0 && (
        <section className="space-y-2" data-testid="starter-topics">
          <h2 className="text-lg font-semibold">Common starting points</h2>
          <p className="text-sm text-muted-foreground">Tick what you already know, so new papers skip it.</p>
          <ul className="flex flex-wrap gap-2">
            {starters.map((t) => (
              <li key={t.key}>
                <Button size="sm" variant="outline" disabled={!knowledge.ready} onClick={() => knowledge.set(t.key, 'known', 'self')} data-testid="starter-topic">
                  {t.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
