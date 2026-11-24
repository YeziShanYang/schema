/**
 * Per-reader state hooks: the reader's checked concepts (one row per
 * concept), their profile topics (one row per topic), and the papers they
 * have opened (one roadmap row per paper). All three collections are
 * own-only, so these queries return just the signed-in reader's rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { ConceptKnowledgeData, ConceptKnowledgeSource, KnowledgeData, KnowledgeSource, KnowledgeStatus, RoadmapData, RoadmapStatus, TopicData } from '../types'

export function useTopics() {
  const { records, status } = useQuery<TopicData>('topics', { limit: 5000 })
  const byKey = useMemo(() => {
    const m = new Map<string, RecordData<TopicData>>()
    for (const r of records) m.set(r.data.key, r)
    return m
  }, [records])
  return { topics: records, byKey, status }
}

type Shown = 'known' | null

/**
 * Rows of an own-only collection keyed by one field, with writes serialized
 * per key. A key's writes run one after another on a promise chain that
 * carries the row id, so a second click inside the round trip of the first
 * becomes an update of the row the first created instead of a second create
 * (which uniqueOn would refuse). The new state shows at once through a local
 * override until the chain settles.
 */
function useKeyedRows<T extends { userId: string; status: string }>(collection: string, keyOf: (d: T) => string) {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<T>(collection, { limit: 5000 })
  const { ready, createConfirmed, putConfirmed, removeConfirmed } = useMutations<T>(collection)
  const rows = useMemo(() => (isSignedIn ? records : []), [isSignedIn, records])

  const byKey = useMemo(() => {
    const m = new Map<string, RecordData<T>>()
    for (const r of rows) m.set(keyOf(r.data), r)
    return m
  }, [rows, keyOf])
  const byKeyRef = useRef(byKey)
  byKeyRef.current = byKey

  // key -> tail of that key's write chain, resolving to the row id (or null once removed).
  const chains = useRef(new Map<string, Promise<string | null>>())
  // key -> the row id our last write left (null after a removal), kept until the query shows the same,
  // so a write right after a removal never reuses the removed row's id.
  const lastIds = useRef(new Map<string, string | null>())
  const [overrides, setOverrides] = useState<Map<string, Shown>>(() => new Map())
  useEffect(() => {
    for (const [k, id] of lastIds.current) if ((byKey.get(k)?.recordId ?? null) === id) lastIds.current.delete(k)
  }, [byKey])

  const enqueue = useCallback((key: string, shown: Shown, write: (id: string | null) => Promise<string | null>) => {
    setOverrides((m) => new Map(m).set(key, shown))
    const currentId = () => (lastIds.current.has(key) ? lastIds.current.get(key)! : byKeyRef.current.get(key)?.recordId ?? null)
    const start = chains.current.get(key) ?? Promise.resolve(currentId())
    const tail = start
      .then(write)
      .then((id) => {
        lastIds.current.set(key, id)
        return id
      })
      .catch((e) => {
        console.warn(`[${collection}] write for ${key} failed: ${e instanceof Error ? e.message : String(e)}`)
        return currentId()
      })
    chains.current.set(key, tail)
    void tail.finally(() => {
      if (chains.current.get(key) !== tail) return
      chains.current.delete(key)
      setOverrides((m) => {
        const n = new Map(m)
        n.delete(key)
        return n
      })
    })
    return tail.then(() => undefined)
  }, [collection])

  /** Create or update the key's row with `data` (the create also gets userId and `create`). */
  const upsert = useCallback(
    async (key: string, data: Partial<T>, create: Partial<T>) => {
      if (!userId) return
      await enqueue(key, 'known', async (id) => {
        if (id) {
          await putConfirmed(id, data as T)
          return id
        }
        return createConfirmed({ userId, ...create, ...data } as T)
      })
    },
    [createConfirmed, enqueue, putConfirmed, userId],
  )

  const remove = useCallback(
    async (key: string) => {
      await enqueue(key, null, async (id) => {
        if (id) await removeConfirmed(id)
        return null
      })
    },
    [enqueue, removeConfirmed],
  )

  // Two states in the UI: rows stored as "learning" by earlier versions read as not known.
  const statusOf = useCallback(
    (key: string): KnowledgeStatus | null => {
      const s = overrides.has(key) ? overrides.get(key)! : byKey.get(key)?.data.status ?? null
      return s === 'known' ? 'known' : null
    },
    [byKey, overrides],
  )
  const isPending = useCallback((key: string) => overrides.has(key), [overrides])

  // Writes wait for the first query result so an upsert never creates a duplicate row.
  return { ready: ready && !!userId && status === 'ready', status, rows, byKey, statusOf, isPending, upsert, remove }
}

/** Topics the reader declared known on the knowledge page. They only produce hints; they never check a concept. */
export interface ProfileApi {
  ready: boolean
  status: 'loading' | 'ready' | 'error'
  rows: RecordData<KnowledgeData>[]
  byTopic: Map<string, RecordData<KnowledgeData>>
  statusOf: (topicKey: string) => KnowledgeStatus | null
  /** True while a write for this topic is in flight; its control should be disabled. */
  isPending: (topicKey: string) => boolean
  set: (topicKey: string, source?: KnowledgeSource) => Promise<void>
  clear: (topicKey: string) => Promise<void>
}

const topicOf = (d: KnowledgeData) => d.topicKey

export function useProfile(): ProfileApi {
  const k = useKeyedRows<KnowledgeData>('knowledge', topicOf)
  const { upsert, remove } = k
  const set = useCallback<ProfileApi['set']>(
    (topicKey, source = 'self') => upsert(topicKey, { status: 'known', source }, { topicKey, paperId: '', arxivId: '' }),
    [upsert],
  )
  return { ready: k.ready, status: k.status, rows: k.rows, byTopic: k.byKey, statusOf: k.statusOf, isPending: k.isPending, set, clear: remove }
}

/** What a checkmark records about its concept, for hints and the knowledge page. */
export interface ConceptRef {
  conceptId: string
  paperId: string
  arxivId: string
  conceptName: string
  topicKey: string
}

/** Per-concept checkmarks. Checking a concept never checks anything in another paper. */
export interface ConceptKnowledgeApi {
  ready: boolean
  status: 'loading' | 'ready' | 'error'
  rows: RecordData<ConceptKnowledgeData>[]
  byConcept: Map<string, RecordData<ConceptKnowledgeData>>
  /** By the concept's record id. */
  statusOf: (conceptId: string) => KnowledgeStatus | null
  isPending: (conceptId: string) => boolean
  set: (concept: ConceptRef, source: ConceptKnowledgeSource) => Promise<void>
  clear: (conceptId: string) => Promise<void>
}

const conceptOf = (d: ConceptKnowledgeData) => d.conceptId

export function useConceptKnowledge(): ConceptKnowledgeApi {
  const k = useKeyedRows<ConceptKnowledgeData>('concept_knowledge', conceptOf)
  const { upsert, remove } = k
  const set = useCallback<ConceptKnowledgeApi['set']>(
    (c, source) =>
      upsert(
        c.conceptId,
        { status: 'known', source, conceptName: c.conceptName, topicKey: c.topicKey, paperId: c.paperId, arxivId: c.arxivId, stale: false },
        { conceptId: c.conceptId },
      ),
    [upsert],
  )
  return { ready: k.ready, status: k.status, rows: k.rows, byConcept: k.byKey, statusOf: k.statusOf, isPending: k.isPending, set, clear: remove }
}

/** Checked concepts per paper id, without stale rows (left by a re-analysis with no matching concept). */
export function checkedPerPaper(rows: RecordData<ConceptKnowledgeData>[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    if (r.data.status !== 'known' || r.data.stale) continue
    m.set(r.data.paperId, (m.get(r.data.paperId) ?? 0) + 1)
  }
  return m
}

export interface RoadmapsApi {
  ready: boolean
  /** Most recently opened first. */
  rows: RecordData<RoadmapData>[]
  byPaper: Map<string, RecordData<RoadmapData>>
  touch: (paper: { paperId: string; arxivId: string; title: string }) => Promise<void>
  setStatus: (paperId: string, status: RoadmapStatus) => Promise<void>
  /** Records that the reader has read the paper's overview (overviewReadAt), or clears it. */
  setOverviewRead: (paper: { paperId: string; arxivId: string; title: string }, read: boolean) => Promise<void>
}

const TOUCH_INTERVAL_MS = 60_000

export function useRoadmaps(): RoadmapsApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<RoadmapData>('roadmaps', { limit: 1000 })
  const { ready, create, put } = useMutations<RoadmapData>('roadmaps')

  const rows = useMemo(
    () => (isSignedIn ? [...records].sort((a, b) => (b.data.lastOpenedAt ?? 0) - (a.data.lastOpenedAt ?? 0)) : []),
    [records, isSignedIn],
  )
  const byPaper = useMemo(() => {
    const m = new Map<string, RecordData<RoadmapData>>()
    for (const r of rows) m.set(r.data.paperId, r)
    return m
  }, [rows])

  const touch = useCallback<RoadmapsApi['touch']>(
    async ({ paperId, arxivId, title }) => {
      if (!userId) return
      const now = Date.now()
      const existing = byPaper.get(paperId)
      if (existing) {
        if (now - (existing.data.lastOpenedAt ?? 0) < TOUCH_INTERVAL_MS && existing.data.title === title) return
        await put(existing.recordId, { lastOpenedAt: now, title })
      } else {
        await create({ userId, paperId, arxivId, title, status: 'reading', lastOpenedAt: now, finishedAt: 0 })
      }
    },
    [byPaper, create, put, userId],
  )

  const setStatus = useCallback<RoadmapsApi['setStatus']>(
    async (paperId, status) => {
      const existing = byPaper.get(paperId)
      if (!existing) return
      await put(existing.recordId, { status, finishedAt: status === 'finished' ? Date.now() : 0 })
    },
    [byPaper, put],
  )

  const setOverviewRead = useCallback<RoadmapsApi['setOverviewRead']>(
    async ({ paperId, arxivId, title }, read) => {
      if (!userId) return
      const overviewReadAt = read ? Date.now() : 0
      const existing = byPaper.get(paperId)
      if (existing) await put(existing.recordId, { overviewReadAt })
      else await create({ userId, paperId, arxivId, title, status: 'reading', lastOpenedAt: Date.now(), finishedAt: 0, overviewReadAt })
    },
    [byPaper, create, put, userId],
  )

  return { ready: ready && !!userId && status === 'ready', rows, byPaper, touch, setStatus, setOverviewRead }
}
