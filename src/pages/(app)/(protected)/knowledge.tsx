/**
 * Knowledge: the concepts the reader checked, grouped by paper and
 * searchable, and their profile, the topics they declared known (the
 * starter list plus search over the shared vocabulary). Profile topics only
 * produce hints on concepts; they never check one. Rows written before
 * per-concept knowledge existed are profile topics too.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Input } from '@/components/ui'
import { Chip, PageHeader } from '../../../components/blueprint'
import { StatusControl } from '../../../components/StatusControl'
import { ConceptName } from '../../../components/MathText'
import { useConceptKnowledge, useProfile, useRoadmaps, useTopics } from '../../../hooks/useReader'
import { actions } from '../../../lib/actions-client'
import { arxivSlug } from '../../../lib/arxiv'
import { STARTER_TOPICS } from '../../../lib/topics'
import type { ConceptKnowledgeData, KnowledgeData, PaperData, TopicLevel } from '../../../types'

const LEVELS: TopicLevel[] = ['foundation', 'core', 'specialized']
const SOURCE: Record<string, string> = { self: 'Checked by you', finished: 'Checked when you finished the paper' }

const at = (r: RecordData<unknown>) => Date.parse(String(r.updatedAt ?? r.createdAt ?? '')) || 0

export default function KnowledgePage() {
  const concepts = useConceptKnowledge()
  const profile = useProfile()
  const roadmaps = useRoadmaps()
  const { topics, byKey, status: topicsStatus } = useTopics()
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const paperById = useMemo(() => new Map(papers.records.map((p) => [p.recordId, p])), [papers.records])
  const [find, setFind] = useState('')
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

  const titleOf = (paperId: string, arxivId: string) =>
    paperById.get(paperId)?.data.title || roadmaps.byPaper.get(paperId)?.data.title || `arXiv ${arxivId}`

  // Checked concepts by paper, the most recently changed paper first.
  const needle = find.trim().toLowerCase()
  const groups = useMemo(() => {
    const rows = concepts.rows.filter((r) => r.data.status === 'known')
    const byPaper = new Map<string, RecordData<ConceptKnowledgeData>[]>()
    for (const r of rows) {
      const list = byPaper.get(r.data.paperId) ?? []
      list.push(r)
      byPaper.set(r.data.paperId, list)
    }
    return [...byPaper.entries()]
      .map(([paperId, list]) => ({
        paperId,
        arxivId: list[0].data.arxivId,
        latest: Math.max(...list.map(at)),
        rows: [...list].sort((a, b) => Number(!!a.data.stale) - Number(!!b.data.stale) || a.data.conceptName.localeCompare(b.data.conceptName)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [concepts.rows])
  const shown = groups
    .map((g) => {
      if (!needle) return g
      const title = titleOf(g.paperId, g.arxivId).toLowerCase()
      return title.includes(needle) || g.arxivId.includes(needle) ? g : { ...g, rows: g.rows.filter((r) => r.data.conceptName.toLowerCase().includes(needle)) }
    })
    .filter((g) => g.rows.length > 0)
  const checkedCount = groups.reduce((n, g) => n + g.rows.length, 0)

  // Profile topics: rows stored as "learning" by earlier versions count as not known.
  const profileRows = profile.rows.filter((r) => r.data.status === 'known')
  const inProfile = (key: string) => profile.byTopic.get(key)?.data.status === 'known'
  const starters = STARTER_TOPICS.filter((t) => !inProfile(t.key) && byKey.has(t.key))
  const matches = q.trim()
    ? topics.filter((t) => !inProfile(t.data.key) && t.data.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20)
    : []
  const setProfile = (topicKey: string) => (next: 'known' | 'learning' | null) => (next === null ? profile.clear(topicKey) : profile.set(topicKey))

  function profileList(items: RecordData<KnowledgeData>[]) {
    const byLevel = LEVELS.map((level) => ({ level, items: items.filter((r) => (byKey.get(r.data.topicKey)?.data.level ?? 'core') === level) })).filter((g) => g.items.length)
    if (items.length === 0) return <p className="surface p-4 text-sm text-muted-foreground">No topics in your profile yet.</p>
    return (
      <div className="surface divide-y divide-border">
        {byLevel.map((g) => (
          <div key={g.level} className="px-4 py-3">
            <div className="label pb-1.5 text-faint">{g.level}</div>
            <ul className="flex flex-col gap-2">
              {g.items.map((r) => {
                const t = byKey.get(r.data.topicKey)?.data
                const on = profile.statusOf(r.data.topicKey) === 'known'
                return (
                  <li
                    key={r.recordId}
                    className={'status-surface grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-2 ' + (on ? 'known-outline' : 'border-border')}
                    data-testid="knowledge-item"
                    data-topic-key={r.data.topicKey}
                  >
                    <div className="min-w-0">
                      <p className="font-medium leading-snug"><ConceptName name={t?.name ?? r.data.topicKey} /></p>
                      {t?.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{t.description}</p>}
                    </div>
                    <StatusControl status={profile.statusOf(r.data.topicKey)} name={t?.name ?? r.data.topicKey} disabled={!profile.ready || profile.isPending(r.data.topicKey)} onChange={setProfile(r.data.topicKey)} />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-full" data-testid="knowledge-page" data-ready={concepts.status === 'ready' && profile.status === 'ready' ? 'true' : undefined}>
      <PageHeader label="Knowledge" title="What you know" />
      <div className="grid max-w-4xl gap-6 px-5 py-6 md:px-7">
        <p className="-mt-1 text-sm text-muted-foreground">
          Each concept has its own checkmark, and checking one never checks anything in another paper. When a later paper uses an idea you checked, or a topic in your profile, its concept shows a note and you tick it yourself.
        </p>

        <section data-testid="checked-concepts">
          <div className="label pb-2">Checked concepts · <span className="tabular-nums">{checkedCount}</span></div>
          {checkedCount === 0 ? (
            <p className="surface p-4 text-sm text-muted-foreground">Nothing checked yet. Open a paper and tick the concepts you know.</p>
          ) : (
            <>
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a concept or paper" aria-label="Find checked concepts" data-testid="checked-search" className="mb-3" />
              {shown.length === 0 && <p className="text-sm text-muted-foreground">No checked concept matches “{find.trim()}”.</p>}
              <div className="grid gap-3">
                {shown.map((g) => (
                  <div key={g.paperId} className="surface px-4 py-3" data-testid="checked-paper" data-paper-id={g.paperId}>
                    <p className="pb-2 text-sm">
                      <Link to={`/p/${arxivSlug(g.arxivId)}`} className="font-medium hover:text-primary hover:underline">{titleOf(g.paperId, g.arxivId)}</Link>{' '}
                      <span className="font-mono text-xs text-faint">arXiv {g.arxivId}</span>
                    </p>
                    <ul className="flex flex-col gap-2">
                      {g.rows.map((r) => {
                        const on = concepts.statusOf(r.data.conceptId) === 'known'
                        return (
                          <li
                            key={r.recordId}
                            className={'status-surface grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-2 ' + (on ? 'known-outline' : 'border-border')}
                            data-testid="checked-concept"
                            data-concept-id={r.data.conceptId}
                            data-stale={r.data.stale ? 'true' : undefined}
                          >
                            <div className="min-w-0">
                              <p className="font-medium leading-snug"><ConceptName name={r.data.conceptName || 'Unnamed concept'} /></p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                                <span>{SOURCE[r.data.source] ?? SOURCE.self}</span>
                                {/* stale is stored as 0 or 1, and a bare 0 would render as text. */}
                                {!!r.data.stale && <Chip>From an earlier analysis</Chip>}
                              </p>
                            </div>
                            <StatusControl
                              status={concepts.statusOf(r.data.conceptId)}
                              name={r.data.conceptName}
                              disabled={!concepts.ready || concepts.isPending(r.data.conceptId)}
                              onChange={(next) => (next === null ? concepts.clear(r.data.conceptId) : undefined)}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section data-testid="profile" id="profile" className="grid gap-3">
          <div>
            <div className="label pb-1">Profile · <span className="tabular-nums">{profileRows.length}</span></div>
            <p className="text-sm text-muted-foreground">
              Topics you already know from elsewhere. A concept that uses one shows “In your profile” in any paper, and stays unchecked until you tick it.
            </p>
          </div>
          {profileList(profileRows)}

          <div className="surface p-4">
            <div className="label pb-2">Add a topic</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every topic, e.g. softmax" aria-label="Search topics" data-testid="topic-search" />
            {matches.length > 0 && (
              <ul className="mt-2 divide-y divide-border">
                {matches.map((t) => (
                  <li key={t.recordId} className="flex items-center justify-between gap-3 py-2" data-testid="topic-match" data-topic-key={t.data.key}>
                    <span className="min-w-0">
                      <ConceptName name={t.data.name} className="font-medium" /> <Chip className="ml-1">{t.data.level}</Chip>
                    </span>
                    <StatusControl status={profile.statusOf(t.data.key)} name={t.data.name} disabled={!profile.ready || profile.isPending(t.data.key)} onChange={setProfile(t.data.key)} />
                  </li>
                ))}
              </ul>
            )}
            {q.trim() && matches.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No topic matches “{q.trim()}”.</p>}
          </div>

          {starters.length > 0 && (
            <div data-testid="starter-topics" id="starter">
              <div className="label pb-1">Common starting points</div>
              <p className="pb-2 text-sm text-muted-foreground">Tick what you already know. Papers will point these out on the concepts that use them.</p>
              <ul className="flex flex-wrap gap-2">
                {starters.map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      disabled={!profile.ready}
                      onClick={() => profile.set(t.key)}
                      data-testid="starter-topic"
                      className="press cursor-pointer rounded bg-card px-2.5 py-1 text-[13px] shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)] disabled:cursor-not-allowed disabled:opacity-50 border border-transparent"
                    >
                      {t.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
