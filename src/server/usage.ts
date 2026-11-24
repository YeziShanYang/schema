/**
 * Per-user daily caps for metered actions, backed by the server-only
 * `usage_events` collection. An `analyze` event also records who requested a
 * paper (ref = paper record id); it is marked refunded if the analysis fails.
 */

import type { ActionTools, CronContext } from 'deepspace/worker'
import type { Envelope, UsageEventData, UsageKind } from '../types'
import { CAP_WINDOW_MS, capState, DAILY_PAPER_CAP, toMs, type CapState } from '../lib/cap'

export const USAGE_CAPS: Record<UsageKind, number> = {
  analyze: DAILY_PAPER_CAP,
  recommend: 10,
  explain: 30,
  branch: 20,
}

const counted = (e: Envelope<UsageEventData>) => e.data.state !== 'refunded'

export async function usageState(tools: ActionTools, userId: string, kind: UsageKind): Promise<CapState> {
  const cap = USAGE_CAPS[kind]
  const r = await tools.query('usage_events', {
    where: { userId, kind },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: cap * 4 + 10,
  })
  if (!r.success) throw new Error(r.error)
  const rows = (r.data.records as unknown as Envelope<UsageEventData>[]).filter(counted)
  return capState(
    rows.map((x) => x.createdAt),
    Date.now(),
    cap,
  )
}

export async function recordUsage(tools: ActionTools, userId: string, kind: UsageKind, ref: string): Promise<void> {
  await tools.create('usage_events', { userId, kind, ref, state: 'counted' })
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
  const what = { recommend: 'recommendation runs', explain: 'new AI explanations', branch: 'branch link loads' }[kind]
  return `You have used your ${USAGE_CAPS[kind]} ${what} for the last 24 hours. More open up after ${when} UTC.`
}
