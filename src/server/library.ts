/**
 * Server side of the Library save state (src/lib/membership.ts): adding a
 * paper to a workspace, or starting its analysis, saves it in the reader's
 * Library unless it is saved already, so leaving its last workspace keeps it
 * there. The reader may have no roadmaps row for the paper yet (it was filed
 * or requested before they opened it), in which case one is created with
 * lastOpenedAt 0, which keeps it out of the reader's history of opened
 * papers.
 *
 * saveRequestedPapers is the one-off backfill for analyses requested before
 * that rule existed (the `save_requested_papers` owner tool).
 */

import type { ActionTools } from 'deepspace/worker'
import type { Envelope, PaperData, RoadmapData, UsageEventData } from '../types'
import { saveState, savedAtOnFile } from '../lib/membership'

type Tools = Pick<ActionTools, 'query' | 'create' | 'update'>

async function findRoadmap(tools: Tools, userId: string, paperId: string): Promise<Envelope<RoadmapData> | null> {
  const r = await tools.query('roadmaps', { where: { userId, paperId }, limit: 1 })
  if (!r.success) throw new Error(r.error)
  return ((r.data.records as unknown as Envelope<RoadmapData>[])[0] as Envelope<RoadmapData> | undefined) ?? null
}

export async function saveFiledPaper(
  tools: Tools,
  userId: string,
  paper: { paperId: string; arxivId: string; title: string },
  now = Date.now(),
): Promise<void> {
  const row = await findRoadmap(tools, userId, paper.paperId)
  if (row) {
    const savedAt = savedAtOnFile(row.data.savedAt, now)
    if (savedAt !== null) await tools.update('roadmaps', row.recordId, { savedAt })
    return
  }
  const created = await tools.create('roadmaps', {
    userId,
    paperId: paper.paperId,
    arxivId: paper.arxivId,
    title: paper.title,
    status: 'reading',
    lastOpenedAt: 0,
    finishedAt: 0,
    savedAt: now,
  })
  if (created.success) return
  if (!/duplicate|unique/i.test(created.error)) throw new Error(created.error)
  // The reader's browser created the row a moment ago (opening the paper): save that one.
  const raced = await findRoadmap(tools, userId, paper.paperId)
  const savedAt = raced ? savedAtOnFile(raced.data.savedAt, now) : null
  if (raced && savedAt !== null) await tools.update('roadmaps', raced.recordId, { savedAt })
}

// Backfill: papers requested before starting an analysis saved them in the Library.

/** A paper to save in the Library of the reader who requested it. */
export interface RequestedSave {
  userId: string
  paperId: string
  arxivId: string
  title: string
  /** The reader's roadmaps row for the paper, or null when they have none and one is created. */
  roadmapId: string | null
}

export interface RequestedSavesPlan {
  saves: RequestedSave[]
  /** Counted `analyze` usage events read. */
  events: number
  /** Distinct (reader, paper) pairs among them. */
  requests: number
  /** Requests whose paper does not exist (deleted, or the event never got a paper id). */
  missingPaper: number
  /** Requests the reader has saved already. */
  alreadySaved: number
  /** Requests the reader removed from their Library (savedAt 0), which stay removed. */
  removed: number
}

const pairKey = (userId: string, paperId: string) => `${userId}\u0000${paperId}`

/**
 * Which requested papers the backfill saves. Every counted `analyze` usage
 * event names a reader and the paper they requested (a new analysis or a
 * retry). The paper is saved for that reader only when it exists and their
 * roadmaps row for it has no save state (savedAt missing) or does not exist.
 * A saved row is in the Library already, and savedAt 0 means the reader
 * removed the paper, so neither is touched. Refunded events are skipped, and
 * each pair counts once however many events it has.
 */
export function planRequestedSaves(
  events: readonly { data: Partial<UsageEventData> }[],
  papers: ReadonlyMap<string, { arxivId: string; title: string }>,
  roadmaps: readonly { recordId: string; data: { userId: string; paperId: string; savedAt?: number | null } }[],
): RequestedSavesPlan {
  const rowOf = new Map(roadmaps.map((r) => [pairKey(r.data.userId, r.data.paperId), r]))
  const seen = new Set<string>()
  const plan: RequestedSavesPlan = { saves: [], events: 0, requests: 0, missingPaper: 0, alreadySaved: 0, removed: 0 }
  for (const { data: e } of events) {
    if (e.kind !== 'analyze' || e.state === 'refunded' || !e.userId || !e.ref) continue
    plan.events++
    const key = pairKey(e.userId, e.ref)
    if (seen.has(key)) continue
    seen.add(key)
    plan.requests++
    const paper = papers.get(e.ref)
    if (!paper) {
      plan.missingPaper++
      continue
    }
    const row = rowOf.get(key)
    const state = saveState(row?.data.savedAt)
    if (row && state === 'saved') plan.alreadySaved++
    else if (row && state === 'removed') plan.removed++
    else plan.saves.push({ userId: e.userId, paperId: e.ref, arxivId: paper.arxivId, title: paper.title, roadmapId: row?.recordId ?? null })
  }
  return plan
}

export interface SaveRequestedResult extends Omit<RequestedSavesPlan, 'saves'> {
  dryRun: boolean
  /** Papers saved, or in a dry run the papers that would be. */
  saved: number
  /** Of those, the rows created (the reader had none) and the rows updated. */
  created: number
  updated: number
  /** Planned saves left alone because the reader saved or removed the paper before the write. */
  changed: number
  /** Saves that failed; running again retries them. */
  failed: number
  /** Up to 50 of the saves, for the report. */
  sample: { userId: string; arxivId: string; title: string; row: 'create' | 'update' }[]
}

const PAGE = 200
const SAMPLE = 50

/** Every record of `collection` matching `where`, a page at a time. */
async function queryAll<T>(tools: Pick<ActionTools, 'query'>, collection: string, where: Record<string, unknown>): Promise<Envelope<T>[]> {
  const out: Envelope<T>[] = []
  let offset = 0
  for (let page = 0; page < 1000; page++) {
    // The record room pages with `offset` and answers `nextOffset`; ActionTools' type lists neither.
    const opts = { where, orderBy: 'createdAt', orderDir: 'asc', limit: PAGE, offset } as Parameters<ActionTools['query']>[1]
    const r = await tools.query(collection, opts)
    if (!r.success) throw new Error(r.error)
    const rows = r.data.records as unknown as Envelope<T>[]
    out.push(...rows)
    const next = (r.data as { nextOffset?: number }).nextOffset
    if (next === undefined || !rows.length) return out
    offset = next
  }
  throw new Error(`Too many ${collection} records to read`)
}

/**
 * Saves each requested paper in its requester's Library, as planned by
 * planRequestedSaves. `read` reads any reader's rows; `writerFor(userId)`
 * writes as that reader, so a created roadmaps row belongs to them. Each
 * planned row is read again just before its write and left alone if the
 * reader saved or removed the paper meanwhile. A second run finds the rows
 * saved and changes nothing. With dryRun nothing is written.
 */
export async function saveRequestedPapers(
  read: Pick<ActionTools, 'query' | 'get'>,
  writerFor: (userId: string) => Tools,
  { dryRun, now = Date.now() }: { dryRun: boolean; now?: number },
): Promise<SaveRequestedResult> {
  const events = await queryAll<UsageEventData>(read, 'usage_events', { kind: 'analyze' })
  const papers = new Map<string, { arxivId: string; title: string }>()
  for (const id of new Set(events.filter((e) => e.data.state !== 'refunded' && e.data.ref).map((e) => e.data.ref))) {
    const r = await read.get('papers', id)
    if (r.success) {
      const p = (r.data as unknown as { record: Envelope<PaperData> }).record
      papers.set(id, { arxivId: p.data.arxivId, title: p.data.title })
    } else if (!/not found/i.test(r.error)) throw new Error(r.error)
  }
  const roadmaps: Envelope<RoadmapData>[] = []
  for (const userId of new Set(events.map((e) => e.data.userId).filter(Boolean))) {
    roadmaps.push(...(await queryAll<RoadmapData>(read, 'roadmaps', { userId })))
  }

  const { saves, ...counts } = planRequestedSaves(events, papers, roadmaps)
  const result: SaveRequestedResult = { ...counts, dryRun, saved: 0, created: 0, updated: 0, changed: 0, failed: 0, sample: [] }
  const done = (s: RequestedSave, row: 'create' | 'update') => {
    result.saved++
    result[row === 'create' ? 'created' : 'updated']++
    if (result.sample.length < SAMPLE) result.sample.push({ userId: s.userId, arxivId: s.arxivId, title: s.title, row })
  }
  for (const s of saves) {
    if (dryRun) {
      done(s, s.roadmapId ? 'update' : 'create')
      continue
    }
    const tools = writerFor(s.userId)
    try {
      const row = await findRoadmap(tools, s.userId, s.paperId)
      if (row && saveState(row.data.savedAt) !== 'undecided') {
        result.changed++
        continue
      }
      await saveFiledPaper(tools, s.userId, s, now)
      done(s, row ? 'update' : 'create')
    } catch (e) {
      result.failed++
      console.warn(`[saveRequestedPapers] saving ${s.arxivId} for ${s.userId} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}
