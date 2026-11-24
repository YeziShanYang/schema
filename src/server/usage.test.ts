import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { eventsInWindow, reserveUsage, usageState, USAGE_CAPS } from './usage'
import { CAP_WINDOW_MS } from '../lib/cap'

/**
 * In-memory stand-in for the record tools: equality filters, createdAt order,
 * offset paging, and an await before every call so parallel requests
 * interleave the way they do against the record room.
 */
function memoryTools(seed: { userId: string; kind: string; state?: string; createdAt: number }[] = []) {
  let n = 0
  let clock = Date.now() - 1000
  const rows = new Map<string, { recordId: string; createdAt: number; data: Record<string, unknown> }>()
  for (const s of seed) {
    const id = `seed${String(n++).padStart(4, '0')}`
    rows.set(id, { recordId: id, createdAt: s.createdAt, data: { userId: s.userId, kind: s.kind, state: s.state ?? 'counted', ref: '' } })
  }
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3))
  const tools = {
    async create(_c: string, data: Record<string, unknown>) {
      await tick()
      const id = `r${String(n++).padStart(6, '0')}`
      rows.set(id, { recordId: id, createdAt: ++clock, data })
      return { success: true, data: { recordId: id } }
    },
    async query(_c: string, opts: { where?: Record<string, unknown>; orderDir?: string; limit?: number; offset?: number }) {
      await tick()
      let list = [...rows.values()].filter((r) => Object.entries(opts.where ?? {}).every(([k, v]) => r.data[k] === v))
      list.sort((a, b) => a.createdAt - b.createdAt)
      if (opts.orderDir === 'desc') list.reverse()
      list = list.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50))
      return { success: true, data: { records: list.map((r) => ({ ...r })) } }
    },
    async remove(_c: string, id: string) {
      await tick()
      rows.delete(id)
      return { success: true, data: {} }
    },
    async update(_c: string, id: string, data: Record<string, unknown>) {
      await tick()
      const r = rows.get(id)
      if (r) r.data = { ...r.data, ...data }
      return { success: true, data: {} }
    },
  }
  return { tools: tools as unknown as ActionTools, rows }
}

describe('reserveUsage', () => {
  it('lets exactly the remaining number of parallel requests through', async () => {
    const { tools, rows } = memoryTools([
      { userId: 'u', kind: 'analyze', createdAt: Date.now() - 5000 },
      { userId: 'u', kind: 'analyze', createdAt: Date.now() - 4000 },
    ])
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => reserveUsage(tools, 'u', 'analyze', `p${i}`)))
    expect(results.filter((r) => r.ok)).toHaveLength(USAGE_CAPS.analyze - 2)
    // Refused requests leave no row behind.
    expect([...rows.values()].filter((r) => r.data.kind === 'analyze')).toHaveLength(USAGE_CAPS.analyze)
    const refused = results.find((r) => !r.ok)
    expect(refused && !refused.ok && refused.message).toMatch(/daily limit/)
  })

  it('applies to every metered kind', async () => {
    for (const kind of ['explain', 'recommend', 'branch', 'overview'] as const) {
      const { tools } = memoryTools()
      const results = await Promise.all(Array.from({ length: USAGE_CAPS[kind] + 4 }, () => reserveUsage(tools, 'u', kind, 'x')))
      expect(results.filter((r) => r.ok)).toHaveLength(USAGE_CAPS[kind])
    }
  })

  it('counts other users and other kinds separately', async () => {
    const { tools } = memoryTools(Array.from({ length: 5 }, () => ({ userId: 'other', kind: 'analyze', createdAt: Date.now() - 100 })))
    expect((await reserveUsage(tools, 'u', 'analyze', 'p')).ok).toBe(true)
    expect((await reserveUsage(tools, 'u', 'explain', 'c')).ok).toBe(true)
  })
})

describe('eventsInWindow', () => {
  it('counts by the window, so many refunded rows cannot hide counted ones', async () => {
    const now = Date.now()
    const seed = [
      ...Array.from({ length: 4 }, (_, i) => ({ userId: 'u', kind: 'analyze', createdAt: now - 60_000 - i })),
      ...Array.from({ length: 150 }, (_, i) => ({ userId: 'u', kind: 'analyze', state: 'refunded', createdAt: now - 1000 + i })),
      { userId: 'u', kind: 'analyze', createdAt: now - CAP_WINDOW_MS - 10 },
    ]
    const { tools } = memoryTools(seed)
    expect(await eventsInWindow(tools, 'u', 'analyze', now)).toHaveLength(4)
    expect((await usageState(tools, 'u', 'analyze')).remaining).toBe(1)
  })
})
