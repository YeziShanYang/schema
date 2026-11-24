/**
 * Per-user daily caps for metered actions, backed by the server-only
 * `usage_events` collection.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Envelope, UsageEventData, UsageKind } from '../types'
import { capState, type CapState } from '../lib/cap'

export const USAGE_CAPS: Record<UsageKind, number> = {
  recommend: 10,
  explain: 30,
}

export async function usageState(tools: ActionTools, userId: string, kind: UsageKind): Promise<CapState> {
  const cap = USAGE_CAPS[kind]
  const r = await tools.query('usage_events', {
    where: { userId, kind },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: cap + 5,
  })
  if (!r.success) throw new Error(r.error)
  const rows = r.data.records as unknown as Envelope<UsageEventData>[]
  return capState(
    rows.map((x) => x.createdAt),
    Date.now(),
    cap,
  )
}

export async function recordUsage(tools: ActionTools, userId: string, kind: UsageKind, ref: string): Promise<void> {
  await tools.create('usage_events', { userId, kind, ref })
}

export function capMessage(kind: UsageKind, state: CapState): string {
  const when = new Date(state.nextSlotAt).toISOString().slice(11, 16)
  const what = kind === 'recommend' ? 'recommendation runs' : 'new AI explanations'
  return `You have used your ${USAGE_CAPS[kind]} ${what} for the last 24 hours. More open up after ${when} UTC.`
}
