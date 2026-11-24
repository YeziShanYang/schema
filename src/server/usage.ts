/**
 * Per-user daily caps for metered actions, backed by the server-only
 * `usage_events` collection. An `analyze` event also records who requested a
 * paper (ref = paper record id).
 *
 * A metered action reserves its slot before any paid work: it inserts a
 * counted event, then recounts the window, and keeps the slot only if fewer
 * than `cap` counted events came before its own. Otherwise it deletes its
 * reservation and fails. Parallel requests therefore cannot all pass a check
 * made before any of them was recorded. Work that turns out to cost nothing
 * releases its reservation.
 */

import type { ActionTools, CronContext } from 'deepspace/worker'
import type { Envelope, UsageEventData, UsageKind } from '../types'
import { CAP_WINDOW_MS, capState, DAILY_PAPER_CAP, toMs, type CapState } from '../lib/cap'

export const USAGE_CAPS: Record<UsageKind, number> = {
  analyze: DAILY_PAPER_CAP,
  recommend: 10,
  explain: 30,
  branch: 20,
  overview: 10,
}

const PAGE = 100

const counted = (e: Envelope<UsageEventData>) => e.data.state !== 'refunded'

/** Order events the way they were inserted: by creation time, then record id. */
function byInsertion(a: Envelope<UsageEventData>, b: Envelope<UsageEventData>): number {
  return toMs(a.createdAt) - toMs(b.createdAt) || (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0)
}

/**
 * This user's counted events of one kind inside the rolling window, oldest
 * first. Pages newest-first until it passes the window, so refunded rows or
 * a long history never hide a counted one.
 */
export async function eventsInWindow(tools: ActionTools, userId: string, kind: UsageKind, now = Date.now()): Promise<Envelope<UsageEventData>[]> {
  const out: Envelope<UsageEventData>[] = []
  for (let offset = 0; offset < 50 * PAGE; offset += PAGE) {
    // The record room pages with `offset`; ActionTools' type does not list it.
    const opts = { where: { userId, kind }, orderBy: 'createdAt', orderDir: 'desc', limit: PAGE, offset } as Parameters<ActionTools['query']>[1]
    const r = await tools.query('usage_events', opts)
    if (!r.success) throw new Error(r.error)
    const rows = r.data.records as unknown as Envelope<UsageEventData>[]
    let passedWindow = false
    for (const e of rows) {
      if (now - toMs(e.createdAt) >= CAP_WINDOW_MS) {
        passedWindow = true
        continue
      }
      if (counted(e)) out.push(e)
    }
    if (passedWindow || rows.length < PAGE) break
  }
  return out.sort(byInsertion)
}

export async function usageState(tools: ActionTools, userId: string, kind: UsageKind): Promise<CapState> {
  const rows = await eventsInWindow(tools, userId, kind)
  return capState(rows.map((x) => x.createdAt), Date.now(), USAGE_CAPS[kind])
}

export type Reservation =
  | { ok: true; id: string; state: CapState }
  | { ok: false; message: string; state: CapState }

/** Reserve one slot of `kind` for this user before doing paid work. */
export async function reserveUsage(tools: ActionTools, userId: string, kind: UsageKind, ref: string): Promise<Reservation> {
  const created = await tools.create('usage_events', { userId, kind, ref, state: 'counted' })
  if (!created.success) throw new Error(created.error)
  const id = created.data.recordId
  const rows = await eventsInWindow(tools, userId, kind)
  const mine = rows.findIndex((e) => e.recordId === id)
  const before = mine === -1 ? rows.length : mine
  const cap = USAGE_CAPS[kind]
  const others = rows.filter((e) => e.recordId !== id)
  if (before >= cap) {
    await tools.remove('usage_events', id)
    const state = capState(others.map((x) => x.createdAt), Date.now(), cap)
    return { ok: false, message: capMessage(kind, state), state }
  }
  return { ok: true, id, state: capState(rows.slice(0, before + 1).map((x) => x.createdAt), Date.now(), cap) }
}

/** Give back a reservation whose work turned out to cost nothing. */
export async function releaseUsage(tools: ActionTools, id: string): Promise<void> {
  await tools.remove('usage_events', id)
}

/** Point a reservation at what it paid for (the paper id once the paper row exists). */
export async function setUsageRef(tools: ActionTools, id: string, ref: string): Promise<void> {
  await tools.update('usage_events', id, { ref })
}

/** Whether this user already has a counted event for `ref` inside the cap window. */
export async function usedRecently(tools: ActionTools, userId: string, kind: UsageKind, ref: string): Promise<boolean> {
  const r = await tools.query('usage_events', { where: { userId, kind, ref }, limit: 20 })
  if (!r.success) return false
  const now = Date.now()
  return (r.data.records as unknown as Envelope<UsageEventData>[]).some(
    (e) => counted(e) && now - toMs(e.createdAt) < CAP_WINDOW_MS,
  )
}

/** Users who requested this paper (counted or refunded), for the retry permission check. */
export async function paperRequesters(tools: ActionTools, paperId: string): Promise<Set<string>> {
  const r = await tools.query('usage_events', { where: { kind: 'analyze', ref: paperId }, limit: 50 })
  if (!r.success) return new Set()
  return new Set((r.data.records as unknown as Envelope<UsageEventData>[]).map((e) => e.data.userId))
}

/** Give back the daily slot(s) a paper's analysis used. Works from actions and from the job. */
export async function refundAnalyze(
  records: Pick<CronContext['records'], 'query' | 'update'>,
  paperId: string,
): Promise<number> {
  const rows = (await records.query('usage_events', { where: { kind: 'analyze', ref: paperId }, limit: 50 })) as Envelope<UsageEventData>[]
  let n = 0
  for (const e of rows) {
    if (!counted(e)) continue
    await records.update('usage_events', e.recordId, { state: 'refunded' })
    n++
  }
  return n
}

/** Adapts ActionTools to the minimal records interface refundAnalyze needs. */
export function actionRecords(tools: ActionTools): Pick<CronContext['records'], 'query' | 'update'> {
  return {
    query: async (collection, opts) => {
      const r = await tools.query(collection, opts)
      return r.success ? (r.data.records as unknown[]) : []
    },
    update: async (collection, recordId, data) => {
      const r = await tools.update(collection, recordId, data)
      if (!r.success) throw new Error(r.error)
      return r.data
    },
  }
}

export function capMessage(kind: UsageKind, state: CapState): string {
  const when = new Date(state.nextSlotAt).toISOString().slice(11, 16)
  if (kind === 'analyze') {
    return `You have started ${USAGE_CAPS.analyze} new papers in the last 24 hours, the daily limit. You can start another after ${when} UTC. Papers someone already analyzed are always free to open.`
  }
  const what = { recommend: 'recommendation runs', explain: 'new AI explanations', branch: 'branch link loads', overview: 'new paper overviews' }[kind]
  return `You have used your ${USAGE_CAPS[kind]} ${what} for the last 24 hours. More open up after ${when} UTC.`
}
