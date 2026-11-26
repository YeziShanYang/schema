/**
 * Per-reader state hooks: the reader's checked concepts (one row per
 * concept), their profile topics (one row per topic), and one roadmap row per
 * paper they opened, saved or filed (history, reading state and the Library
 * save state; useLibrary builds the Library from it). All three collections
 * are own-only, so these queries return just the signed-in reader's rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { ConceptKnowledgeData, ConceptKnowledgeSource, KnowledgeData, KnowledgeSource, KnowledgeStatus, RoadmapData, RoadmapStatus, TopicData } from '../types'
import { savedAtOnReopen } from '../lib/membership'

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
/** How long a confirmed write's optimistic state waits for the query to show it. */
const OVERRIDE_HOLD_MS = 10_000

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
  // Whether the query already shows what a write left, so its optimistic state can go.
  const shows = useCallback((key: string, shown: Shown) => {
    const row = byKeyRef.current.get(key)
    return shown === 'known' ? row?.data.status === 'known' : !row
  }, [])
  const dropOverride = useCallback((key: string) => {
    setOverrides((m) => {
      if (!m.has(key)) return m
      const n = new Map(m)
      n.delete(key)
      return n
    })
  }, [])
  useEffect(() => {
    for (const [k, id] of lastIds.current) if ((byKey.get(k)?.recordId ?? null) === id) lastIds.current.delete(k)
    // A finished write keeps its optimistic state until the query catches up, so the control never flickers back.
    setOverrides((m) => {
      let n: Map<string, Shown> | null = null
      for (const [k, shown] of m) {
        if (chains.current.has(k) || !shows(k, shown)) continue
        n ??= new Map(m)
        n.delete(k)
      }
      return n ?? m
    })
  }, [byKey, shows])

  const enqueue = useCallback((key: string, shown: Shown, write: (id: string | null) => Promise<string | null>) => {
    setOverrides((m) => new Map(m).set(key, shown))
    const currentId = () => (lastIds.current.has(key) ? lastIds.current.get(key)! : byKeyRef.current.get(key)?.recordId ?? null)
    const start = chains.current.get(key) ?? Promise.resolve(currentId())
    let failed = false
    const tail = start
      .then(write)
      .then((id) => {
        lastIds.current.set(key, id)
        return id
      })
      .catch((e) => {
        failed = true
        console.warn(`[${collection}] write for ${key} failed: ${e instanceof Error ? e.message : String(e)}`)
        return currentId()
      })
    chains.current.set(key, tail)
    void tail.finally(() => {
      if (chains.current.get(key) !== tail) return
      chains.current.delete(key)
      // A failed write shows the stored state again. A confirmed one waits for the query (see the effect above),
      // or at most OVERRIDE_HOLD_MS, so a missed update can't leave the control stuck.
      if (failed || shows(key, shown)) dropOverride(key)
      else setTimeout(() => !chains.current.has(key) && dropOverride(key), OVERRIDE_HOLD_MS)
    })
    return tail.then(() => undefined)
  }, [collection, dropOverride, shows])

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

/** What a roadmaps row records about its paper. */
export interface PaperRef {
  paperId: string
  arxivId: string
  title: string
}

export interface RoadmapsApi {
  /** Writes can go out: the rows have loaded and the connection is up. */
  ready: boolean
  /** The rows' query. A reconnect sets it back to loading while the last rows stay. */
  status: 'loading' | 'ready' | 'error'
  /** Every row, most recently opened first. Rows of papers saved or filed but never opened have lastOpenedAt 0. */
  rows: RecordData<RoadmapData>[]
  /** The history of opened papers (Recent papers, Continue): rows with a lastOpenedAt, most recent first. */
  opened: RecordData<RoadmapData>[]
  byPaper: Map<string, RecordData<RoadmapData>>
  /** Records an open. It never changes the Library save state. */
  touch: (paper: PaperRef) => Promise<void>
  /**
   * Finished or reading. Given the paper (not just its id), it creates the
   * row when there is none. Reading again also saves an undecided paper, so
   * it stays in the Library (lib/membership).
   */
  setStatus: (paper: PaperRef | string, status: RoadmapStatus) => Promise<void>
  /** Records that the reader has read the paper's overview (overviewReadAt), or clears it. */
  setOverviewRead: (paper: PaperRef, read: boolean) => Promise<void>
  /** Writes the Library save state (lib/membership), creating the row when the paper has none. */
  setSavedAt: (paper: PaperRef, savedAt: number) => Promise<void>
}

const TOUCH_INTERVAL_MS = 60_000
/** How long a write that lost a create race waits for the other writer's row to arrive. */
const ROW_WAIT_MS = 5_000

export function useRoadmaps(): RoadmapsApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<RoadmapData>('roadmaps', { limit: 1000 })
  const { ready, createConfirmed, putConfirmed } = useMutations<RoadmapData>('roadmaps')

  const rows = useMemo(
    () => (isSignedIn ? [...records].sort((a, b) => (b.data.lastOpenedAt ?? 0) - (a.data.lastOpenedAt ?? 0)) : []),
    [records, isSignedIn],
  )
  const opened = useMemo(() => rows.filter((r) => (r.data.lastOpenedAt ?? 0) > 0), [rows])
  const byPaper = useMemo(() => {
    const m = new Map<string, RecordData<RoadmapData>>()
    for (const r of rows) m.set(r.data.paperId, r)
    return m
  }, [rows])
  const byPaperRef = useRef(byPaper)
  byPaperRef.current = byPaper

  /**
   * Updates the paper's row, or creates it with `patch` on top of the
   * defaults. The server (adding the paper to a workspace) or another tab can
   * create the row first, and uniqueOn then refuses this create; the write
   * then waits for that row to arrive and updates it.
   */
  const upsert = useCallback(
    async (paper: PaperRef, patch: Partial<RoadmapData>) => {
      if (!userId) return
      const existing = byPaperRef.current.get(paper.paperId)
      if (existing) return putConfirmed(existing.recordId, patch)
      try {
        await createConfirmed({ userId, paperId: paper.paperId, arxivId: paper.arxivId, title: paper.title, status: 'reading', lastOpenedAt: 0, finishedAt: 0, ...patch })
      } catch (e) {
        for (let waited = 0; waited < ROW_WAIT_MS; waited += 100) {
          const row = byPaperRef.current.get(paper.paperId)
          if (row) return putConfirmed(row.recordId, patch)
          await new Promise((r) => setTimeout(r, 100))
        }
        throw e
      }
    },
    [createConfirmed, putConfirmed, userId],
  )

  const touch = useCallback<RoadmapsApi['touch']>(
    async (paper) => {
      const existing = byPaperRef.current.get(paper.paperId)
      const now = Date.now()
      if (existing && now - (existing.data.lastOpenedAt ?? 0) < TOUCH_INTERVAL_MS && existing.data.title === paper.title) return
      try {
        await upsert(paper, { lastOpenedAt: now, title: paper.title })
      } catch (e) {
        // History only: a lost write leaves Recent papers one open behind, and nothing else depends on it.
        console.warn(`[roadmaps] recording the open of ${paper.arxivId} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [upsert],
  )

  const setStatus = useCallback<RoadmapsApi['setStatus']>(
    async (paper, status) => {
      const paperId = typeof paper === 'string' ? paper : paper.paperId
      const existing = byPaperRef.current.get(paperId)
      const now = Date.now()
      const savedAt = status === 'reading' ? savedAtOnReopen(existing?.data.savedAt, now) : null
      const patch = { status, finishedAt: status === 'finished' ? now : 0, ...(savedAt !== null ? { savedAt } : {}) }
      if (existing) await putConfirmed(existing.recordId, patch)
      // A paper finished from the Library may have no row yet (it is only in a workspace); finishing is not an open.
      else if (typeof paper !== 'string') await upsert(paper, patch)
    },
    [putConfirmed, upsert],
  )

  const setOverviewRead = useCallback<RoadmapsApi['setOverviewRead']>(
    async (paper, read) => {
      const overviewReadAt = read ? Date.now() : 0
      // Marking the overview read on a paper with no row yet happens on its page, so the new row counts as an open.
      await upsert(paper, byPaperRef.current.has(paper.paperId) ? { overviewReadAt } : { overviewReadAt, lastOpenedAt: Date.now() })
    },
    [upsert],
  )

  const setSavedAt = useCallback<RoadmapsApi['setSavedAt']>((paper, savedAt) => upsert(paper, { savedAt }), [upsert])

  return { ready: ready && !!userId && status === 'ready', status, rows, opened, byPaper, touch, setStatus, setOverviewRead, setSavedAt }
}
