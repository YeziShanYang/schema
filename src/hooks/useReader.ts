/**
 * Per-reader state hooks: the knowledge profile (one row per topic) and the
 * papers this reader has opened (one roadmap row per paper). Both collections
 * are own-only, so these queries return just the signed-in reader's rows.
 */

import { useCallback, useMemo } from 'react'
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
  set: (
    topicKey: string,
    status: KnowledgeStatus,
    source: KnowledgeSource,
    from?: { paperId?: string; arxivId?: string },
  ) => Promise<void>
  clear: (topicKey: string) => Promise<void>
}

export function useKnowledge(): KnowledgeApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<KnowledgeData>('knowledge', { limit: 5000 })
  const { ready, create, put, remove } = useMutations<KnowledgeData>('knowledge')
  const rows = isSignedIn ? records : []

  const byTopic = useMemo(() => {
    const m = new Map<string, RecordData<KnowledgeData>>()
    for (const r of rows) m.set(r.data.topicKey, r)
    return m
  }, [rows])

  const set = useCallback<KnowledgeApi['set']>(
    async (topicKey, next, source, from) => {
      if (!userId) return
      const existing = byTopic.get(topicKey)
      if (existing) {
        if (existing.data.status === next) return
        await put(existing.recordId, { status: next, source, paperId: from?.paperId ?? existing.data.paperId, arxivId: from?.arxivId ?? existing.data.arxivId })
      } else {
        await create({ userId, topicKey, status: next, source, paperId: from?.paperId ?? '', arxivId: from?.arxivId ?? '' })
      }
    },
    [byTopic, create, put, userId],
  )

  const clear = useCallback(
    async (topicKey: string) => {
      const existing = byTopic.get(topicKey)
      if (existing) await remove(existing.recordId)
    },
    [byTopic, remove],
  )

  const statusOf = useCallback((topicKey: string) => byTopic.get(topicKey)?.data.status ?? null, [byTopic])

  return { ready: ready && !!userId, status, rows, byTopic, statusOf, set, clear }
}

export interface RoadmapsApi {
  ready: boolean
  /** Most recently opened first. */
  rows: RecordData<RoadmapData>[]
  byPaper: Map<string, RecordData<RoadmapData>>
  touch: (paper: { paperId: string; arxivId: string; title: string }) => Promise<void>
  setStatus: (paperId: string, status: RoadmapStatus) => Promise<void>
}

const TOUCH_INTERVAL_MS = 60_000

export function useRoadmaps(): RoadmapsApi {
  const { userId, isSignedIn } = useAuth()
  const { records } = useQuery<RoadmapData>('roadmaps', { limit: 1000 })
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

  return { ready: ready && !!userId, rows, byPaper, touch, setStatus }
}
