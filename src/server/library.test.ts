import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { saveFiledPaper } from './library'

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
