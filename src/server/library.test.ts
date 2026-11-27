import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { planRequestedSaves, saveFiledPaper, saveRequestedPapers } from './library'

type Row = { recordId: string; data: Record<string, unknown> }

/** The record tools for one collection, with uniqueOn (userId, paperId) like the roadmaps schema. */
function memoryRoadmaps(seed: Row[] = [], opts: { raceOnCreate?: Row } = {}) {
  const rows: Row[] = seed.map((r) => ({ recordId: r.recordId, data: { ...r.data } }))
  let n = 0
  const tools = {
    async query(_c: string, q: { where?: Record<string, unknown> }) {
      const list = rows.filter((r) => Object.entries(q.where ?? {}).every(([k, v]) => r.data[k] === v))
      return { success: true, data: { records: list.map((r) => ({ recordId: r.recordId, data: { ...r.data } })) } }
    },
    async create(_c: string, data: Record<string, unknown>) {
      // Another writer (the reader's browser) got there first.
      if (opts.raceOnCreate && !rows.includes(opts.raceOnCreate)) rows.push(opts.raceOnCreate)
      if (rows.some((r) => r.data.userId === data.userId && r.data.paperId === data.paperId)) {
        return { success: false, error: 'Duplicate: a record with userId, paperId already exists in roadmaps' }
      }
      const row = { recordId: `n${++n}`, data: { ...data } }
      rows.push(row)
      return { success: true, data: { recordId: row.recordId } }
    },
    async update(_c: string, id: string, data: Record<string, unknown>) {
      const row = rows.find((r) => r.recordId === id)
      if (!row) return { success: false, error: 'not found' }
      Object.assign(row.data, data)
      return { success: true, data: {} }
    },
  }
  return { rows, tools: tools as unknown as Pick<ActionTools, 'query' | 'create' | 'update'> }
}

const paper = { paperId: 'p1', arxivId: '0000.00001', title: 'A paper' }
const NOW = 1_800_000_000_000

describe('saveFiledPaper', () => {
  it('creates a saved row, outside the opened history, for a paper the reader never opened', async () => {
    const { rows, tools } = memoryRoadmaps()
    await saveFiledPaper(tools, 'u1', paper, NOW)
    expect(rows.map((r) => r.data)).toEqual([
      { userId: 'u1', paperId: 'p1', arxivId: '0000.00001', title: 'A paper', status: 'reading', lastOpenedAt: 0, finishedAt: 0, savedAt: NOW },
    ])
  })

  it('saves an undecided or removed row and keeps an earlier save time', async () => {
    const { rows, tools } = memoryRoadmaps([
      { recordId: 'a', data: { userId: 'u1', paperId: 'p1', lastOpenedAt: 5 } },
      { recordId: 'b', data: { userId: 'u1', paperId: 'p2', savedAt: 0 } },
      { recordId: 'c', data: { userId: 'u1', paperId: 'p3', savedAt: 7 } },
    ])
    for (const paperId of ['p1', 'p2', 'p3']) await saveFiledPaper(tools, 'u1', { ...paper, paperId }, NOW)
    expect(rows.map((r) => r.data.savedAt)).toEqual([NOW, NOW, 7])
    expect(rows[0].data.lastOpenedAt).toBe(5)
  })

  it('leaves other readers alone', async () => {
    const { rows, tools } = memoryRoadmaps([{ recordId: 'a', data: { userId: 'u2', paperId: 'p1' } }])
    await saveFiledPaper(tools, 'u1', paper, NOW)
    expect(rows.find((r) => r.recordId === 'a')!.data.savedAt).toBeUndefined()
    expect(rows.filter((r) => r.data.userId === 'u1')).toHaveLength(1)
  })

  it('saves the row another writer created first instead of failing', async () => {
    const opened: Row = { recordId: 'browser', data: { userId: 'u1', paperId: 'p1', lastOpenedAt: 9 } }
    const { rows, tools } = memoryRoadmaps([], { raceOnCreate: opened })
    await saveFiledPaper(tools, 'u1', paper, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].data).toEqual({ userId: 'u1', paperId: 'p1', lastOpenedAt: 9, savedAt: NOW })
  })
})

const event = (userId: string, ref: string, state?: 'counted' | 'refunded', kind = 'analyze') => ({ data: { userId, kind, ref, state } as never })
const roadmapRow = (recordId: string, userId: string, paperId: string, savedAt?: number) => ({
  recordId,
  data: { userId, paperId, ...(savedAt === undefined ? {} : { savedAt }) },
})
const PAPERS = new Map([
  ['p1', { arxivId: '0000.00001', title: 'One' }],
  ['p2', { arxivId: '0000.00002', title: 'Two' }],
  ['p3', { arxivId: '0000.00003', title: 'Three' }],
])

describe('planRequestedSaves', () => {
  it('saves a requested paper the reader has no row for, or a row with no save state', () => {
    const plan = planRequestedSaves([event('u1', 'p1', 'counted'), event('u1', 'p2')], PAPERS, [roadmapRow('r2', 'u1', 'p2')])
    expect(plan.saves).toEqual([
      { userId: 'u1', paperId: 'p1', arxivId: '0000.00001', title: 'One', roadmapId: null },
      { userId: 'u1', paperId: 'p2', arxivId: '0000.00002', title: 'Two', roadmapId: 'r2' },
    ])
    expect(plan).toMatchObject({ events: 2, requests: 2, missingPaper: 0, alreadySaved: 0, removed: 0 })
  })

  it('never touches a saved row or one the reader removed', () => {
    const plan = planRequestedSaves([event('u1', 'p1'), event('u1', 'p2')], PAPERS, [roadmapRow('r1', 'u1', 'p1', 5), roadmapRow('r2', 'u1', 'p2', 0)])
    expect(plan.saves).toEqual([])
    expect(plan).toMatchObject({ alreadySaved: 1, removed: 1 })
  })

  it('skips refunded events, other kinds, missing papers and pending refs, and counts each pair once', () => {
    const plan = planRequestedSaves(
      [
        event('u1', 'p1', 'refunded'),
        event('u1', 'p2', 'counted', 'explain'),
        event('u1', 'gone'),
        event('u1', 'pending:0000.00009'),
        event('u2', 'p3'),
        event('u2', 'p3'),
      ],
      PAPERS,
      [],
    )
    expect(plan.saves.map((s) => [s.userId, s.paperId])).toEqual([['u2', 'p3']])
    expect(plan).toMatchObject({ events: 4, requests: 3, missingPaper: 2 })
  })

  it('reads each reader only through their own rows', () => {
    // u2 saved p1, which says nothing about u1's request of it.
    const plan = planRequestedSaves([event('u1', 'p1'), event('u2', 'p1')], PAPERS, [roadmapRow('r1', 'u2', 'p1', 5)])
    expect(plan.saves.map((s) => [s.userId, s.roadmapId])).toEqual([['u1', null]])
    expect(plan.alreadySaved).toBe(1)
  })
})

/**
 * Record tools over shared in-memory collections. Queries match `where` by
 * equality and page with `offset` / `nextOffset`; a roadmaps create stamps
 * userId with the acting reader, as userBound does.
 */
function memoryRoom(seed: Record<string, Row[]>, pageSize = 2) {
  const db: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([c, rows]) => [c, rows.map((r) => ({ recordId: r.recordId, data: { ...r.data } }))]))
  let n = 0
  const writes: string[] = []
  const toolsAs = (actor: string) =>
    ({
      async query(c: string, q: { where?: Record<string, unknown>; limit?: number; offset?: number }) {
        const all = (db[c] ?? []).filter((r) => Object.entries(q.where ?? {}).every(([k, v]) => r.data[k] === v))
        const offset = q.offset ?? 0
        const limit = Math.min(q.limit ?? 50, pageSize)
        const page = all.slice(offset, offset + limit)
        const more = offset + page.length < all.length
        return { success: true, data: { records: page.map((r) => ({ recordId: r.recordId, data: { ...r.data } })), ...(more ? { nextOffset: offset + page.length } : {}) } }
      },
      async get(c: string, id: string) {
        const row = (db[c] ?? []).find((r) => r.recordId === id)
        return row ? { success: true, data: { record: { recordId: row.recordId, data: { ...row.data } } } } : { success: false, error: 'Record not found' }
      },
      async create(c: string, data: Record<string, unknown>) {
        const rows = (db[c] ??= [])
        const stamped: Record<string, unknown> = c === 'roadmaps' ? { ...data, userId: actor } : { ...data }
        if (c === 'roadmaps' && rows.some((r) => r.data.userId === stamped.userId && r.data.paperId === stamped.paperId)) {
          return { success: false, error: 'Duplicate: a record with userId, paperId already exists in roadmaps' }
        }
        const row = { recordId: `n${++n}`, data: stamped }
        rows.push(row)
        writes.push(`create ${c} ${actor}`)
        return { success: true, data: { recordId: row.recordId } }
      },
      async update(c: string, id: string, data: Record<string, unknown>) {
        const row = (db[c] ?? []).find((r) => r.recordId === id)
        if (!row) return { success: false, error: 'not found' }
        Object.assign(row.data, data)
        writes.push(`update ${c} ${id} ${actor}`)
        return { success: true, data: {} }
      },
    }) as unknown as Pick<ActionTools, 'query' | 'get' | 'create' | 'update'>
  return { db, writes, toolsAs }
}

describe('saveRequestedPapers', () => {
  const seed = () => ({
    usage_events: [
      { recordId: 'e1', data: { userId: 'u1', kind: 'analyze', ref: 'p1', state: 'counted' } },
      { recordId: 'e2', data: { userId: 'u1', kind: 'analyze', ref: 'p2', state: 'counted' } },
      { recordId: 'e3', data: { userId: 'u2', kind: 'analyze', ref: 'p1' } },
      { recordId: 'e4', data: { userId: 'u2', kind: 'analyze', ref: 'p2', state: 'counted' } },
      { recordId: 'e5', data: { userId: 'u2', kind: 'analyze', ref: 'p3', state: 'refunded' } },
      { recordId: 'e6', data: { userId: 'u3', kind: 'analyze', ref: 'gone', state: 'counted' } },
      { recordId: 'e7', data: { userId: 'u3', kind: 'explain', ref: 'c1', state: 'counted' } },
    ],
    papers: [...PAPERS].map(([recordId, p]) => ({ recordId, data: { ...p, status: 'ready' } })),
    roadmaps: [
      // u1 opened p2 and never decided; u2 saved p1 and removed p2.
      { recordId: 'r1', data: { userId: 'u1', paperId: 'p2', lastOpenedAt: 7 } },
      { recordId: 'r2', data: { userId: 'u2', paperId: 'p1', savedAt: 3 } },
      { recordId: 'r3', data: { userId: 'u2', paperId: 'p2', savedAt: 0 } },
    ],
  })

  it('reports what it would save in a dry run and writes nothing', async () => {
    const room = memoryRoom(seed())
    const r = await saveRequestedPapers(room.toolsAs('owner'), room.toolsAs, { dryRun: true, now: NOW })
    expect(room.writes).toEqual([])
    expect(r).toMatchObject({ dryRun: true, events: 5, requests: 5, missingPaper: 1, alreadySaved: 1, removed: 1, saved: 2, created: 1, updated: 1, changed: 0, failed: 0 })
    expect(r.sample).toEqual([
      { userId: 'u1', arxivId: '0000.00001', title: 'One', row: 'create' },
      { userId: 'u1', arxivId: '0000.00002', title: 'Two', row: 'update' },
    ])
  })

  it('saves as each reader, leaves saved and removed rows alone, and changes nothing on a second run', async () => {
    const room = memoryRoom(seed())
    const r = await saveRequestedPapers(room.toolsAs('owner'), room.toolsAs, { dryRun: false, now: NOW })
    expect(r).toMatchObject({ dryRun: false, saved: 2, created: 1, updated: 1, failed: 0 })
    expect(room.writes).toEqual(['create roadmaps u1', 'update roadmaps r1 u1'])
    const rows = Object.fromEntries(room.db.roadmaps.map((x) => [`${x.data.userId}/${x.data.paperId}`, x.data]))
    expect(rows['u1/p1']).toEqual({ userId: 'u1', paperId: 'p1', arxivId: '0000.00001', title: 'One', status: 'reading', lastOpenedAt: 0, finishedAt: 0, savedAt: NOW })
    expect(rows['u1/p2']).toEqual({ userId: 'u1', paperId: 'p2', lastOpenedAt: 7, savedAt: NOW })
    expect(rows['u2/p1'].savedAt).toBe(3)
    expect(rows['u2/p2'].savedAt).toBe(0)
    expect(rows['u2/p3']).toBeUndefined()

    const again = await saveRequestedPapers(room.toolsAs('owner'), room.toolsAs, { dryRun: false, now: NOW + 1 })
    expect(again).toMatchObject({ saved: 0, alreadySaved: 3, removed: 1 })
    expect(room.writes).toHaveLength(2)
  })

  it('leaves a row the reader removed after it was read', async () => {
    // The reads see r1 undecided; by the time of the write the reader has removed it.
    const stale = memoryRoom(seed())
    const live = memoryRoom({ ...seed(), roadmaps: [{ recordId: 'r1', data: { userId: 'u1', paperId: 'p2', savedAt: 0 } }] })
    const r = await saveRequestedPapers(stale.toolsAs('owner'), live.toolsAs, { dryRun: false, now: NOW })
    expect(r).toMatchObject({ saved: 1, created: 1, changed: 1 })
    expect(live.db.roadmaps.find((x) => x.recordId === 'r1')!.data.savedAt).toBe(0)
  })
})
