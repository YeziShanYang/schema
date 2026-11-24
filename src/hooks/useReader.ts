/**
 * Per-reader state hooks: the knowledge profile (one row per topic) and the
 * papers this reader has opened (one roadmap row per paper). Both collections
 * are own-only, so these queries return just the signed-in reader's rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { KnowledgeData, KnowledgeSource, KnowledgeStatus, RoadmapData, RoadmapStatus, TopicData } from '../types'

export function useTopics() {
  const { records, status } = useQuery<TopicData>('topics', { limit: 5000 })
  const byKey = useMemo(() => {
    const m = new Map<string, RecordData<TopicData>>()
    for (const r of records) m.set(r.data.key, r)
    return m
  }, [records])
  return { topics: records, byKey, status }
}

export interface KnowledgeApi {
  ready: boolean
  status: 'loading' | 'ready' | 'error'
  rows: RecordData<KnowledgeData>[]
  byTopic: Map<string, RecordData<KnowledgeData>>
  statusOf: (topicKey: string) => KnowledgeStatus | null
  /** True while a write for this topic is in flight; its control should be disabled. */
  isPending: (topicKey: string) => boolean
  set: (
    topicKey: string,
    status: KnowledgeStatus,
    source: KnowledgeSource,
    from?: { paperId?: string; arxivId?: string },
  ) => Promise<void>
  clear: (topicKey: string) => Promise<void>
}

type Override = { status: KnowledgeStatus | null }

/**
 * Writes are serialized per topic. A topic's writes run one after another on
 * a promise chain that carries the row id, so a second click inside the
 * round trip of the first becomes an update of the row the first created
 * instead of a second create (which uniqueOn would refuse). The new status
 * shows at once through a local override until the chain settles.
 */
export function useKnowledge(): KnowledgeApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<KnowledgeData>('knowledge', { limit: 5000 })
  const { ready, createConfirmed, putConfirmed, removeConfirmed } = useMutations<KnowledgeData>('knowledge')
  const rows = isSignedIn ? records : []

  const byTopic = useMemo(() => {
    const m = new Map<string, RecordData<KnowledgeData>>()
    for (const r of rows) m.set(r.data.topicKey, r)
    return m
  }, [rows])
  const byTopicRef = useRef(byTopic)
  byTopicRef.current = byTopic

  // topicKey -> tail of that topic's write chain, resolving to the row id (or null once removed).
  const chains = useRef(new Map<string, Promise<string | null>>())
  // topicKey -> the row id our last write left (null after a removal), kept until the query shows the same,
  // so a write right after a removal never reuses the removed row's id.
  const lastIds = useRef(new Map<string, string | null>())
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map())
  useEffect(() => {
    for (const [k, id] of lastIds.current) if ((byTopic.get(k)?.recordId ?? null) === id) lastIds.current.delete(k)
  }, [byTopic])

  const enqueue = useCallback(
    (topicKey: string, shown: KnowledgeStatus | null, write: (id: string | null) => Promise<string | null>) => {
      setOverrides((m) => new Map(m).set(topicKey, { status: shown }))
      const currentId = () => (lastIds.current.has(topicKey) ? lastIds.current.get(topicKey)! : byTopicRef.current.get(topicKey)?.recordId ?? null)
      const start = chains.current.get(topicKey) ?? Promise.resolve(currentId())
      const tail = start
        .then(write)
        .then((id) => {
          lastIds.current.set(topicKey, id)
          return id
        })
        .catch((e) => {
          console.warn(`[knowledge] write for ${topicKey} failed: ${e instanceof Error ? e.message : String(e)}`)
          return currentId()
        })
      chains.current.set(topicKey, tail)
      void tail.finally(() => {
        if (chains.current.get(topicKey) !== tail) return
        chains.current.delete(topicKey)
        setOverrides((m) => {
          const n = new Map(m)
          n.delete(topicKey)
          return n
        })
      })
      return tail.then(() => undefined)
    },
    [],
  )

  const set = useCallback<KnowledgeApi['set']>(
    async (topicKey, next, source, from) => {
      if (!userId) return
      await enqueue(topicKey, next, async (id) => {
        const row = byTopicRef.current.get(topicKey)
        const data = { status: next, source, paperId: from?.paperId ?? row?.data.paperId ?? '', arxivId: from?.arxivId ?? row?.data.arxivId ?? '' }
        if (id) {
          await putConfirmed(id, data)
          return id
        }
        return createConfirmed({ userId, topicKey, ...data })
      })
    },
    [createConfirmed, enqueue, putConfirmed, userId],
  )

  const clear = useCallback(
    async (topicKey: string) => {
      await enqueue(topicKey, null, async (id) => {
        if (id) await removeConfirmed(id)
        return null
      })
    },
    [enqueue, removeConfirmed],
  )

  const statusOf = useCallback(
    (topicKey: string) => {
      // Two states in the UI: rows stored as "learning" read as not known.
      const o = overrides.get(topicKey)
      const s = o ? o.status : byTopic.get(topicKey)?.data.status ?? null
      return s === 'known' ? 'known' : null
    },
    [byTopic, overrides],
  )
  const isPending = useCallback((topicKey: string) => overrides.has(topicKey), [overrides])

  // Writes wait for the first query result so an upsert never creates a duplicate row.
  return { ready: ready && !!userId && status === 'ready', status, rows, byTopic, statusOf, isPending, set, clear }
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
