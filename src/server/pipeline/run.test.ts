/**
 * Drives the real analyze job tick by tick against an in-memory record store
 * and the fixture integrations, to check the timings and retry bookkeeping it
 * writes on the paper. Only the platform boundary (deepspace/worker) is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import type { PaperData } from '../../types'
import { TIMED_STAGES, lastStartedStage, openStage, queuedTimings, stageDurations } from '../../lib/timings'
import { FIXTURE_META, fixtureIntegration } from './fixtures'
import { runAnalyzeTick, type AnalyzeState } from './run'

type Row = { recordId: string; data: Record<string, unknown> }

const h = vi.hoisted(() => {
  const rooms = new Map<string, Row[]>()
  let n = 0
  const rows = (c: string) => {
    if (!rooms.has(c)) rooms.set(c, [])
    return rooms.get(c)!
  }
  const records = {
    async query(collection: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
      const where = Object.entries(opts?.where ?? {})
      return rows(collection)
        .filter((r) => where.every(([k, v]) => r.data[k] === v))
        .slice(0, opts?.limit ?? 1000)
        .map((r) => ({ recordId: r.recordId, data: structuredClone(r.data) }))
    },
    async create(collection: string, data: Record<string, unknown>) {
      const row = { recordId: `r${++n}`, data: structuredClone(data) }
      rows(collection).push(row)
      return row
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>) {
      const row = rows(collection).find((r) => r.recordId === recordId)
      if (!row) throw new Error('not found')
      Object.assign(row.data, structuredClone(data))
      return row
    },
    async delete(collection: string, recordId: string) {
      const list = rows(collection)
      const i = list.findIndex((r) => r.recordId === recordId)
      if (i < 0) throw new Error('not found')
      list.splice(i, 1)
    },
  }
  return { rooms, records, reset: () => rooms.clear() }
})

vi.mock('deepspace/worker', () => ({
  buildCronContext: () => ({ records: h.records }),
  appFiles: () => ({
    download: async () => {
      throw new Error('no stored text')
    },
    upload: async () => ({ key: 'unused' }),
  }),
}))

vi.mock('./fixtures', async (importOriginal) => {
  const m = await importOriginal<typeof import('./fixtures')>()
  return { ...m, fixtureIntegration: vi.fn(m.fixtureIntegration) }
})

const env = { ALLOW_DEBUG_ROUTES: 'true', OWNER_USER_ID: 'owner', DEEPSPACE_APP_ID: 'test' } as unknown as Env
const START = Date.UTC(2026, 10, 24, 12, 0, 0)
/** Wall time each tick takes in these runs. */
const TICK_MS = 1000

async function createPaper(arxivId: string): Promise<string> {
  const row = await h.records.create('papers', {
    ...FIXTURE_META,
    arxivId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    progressMessage: 'Waiting to start',
    branches: [],
    timings: queuedTimings(Date.now()),
    retries: 0,
  })
  return row.recordId
}

async function paperData(recordId: string): Promise<PaperData> {
  const [row] = (await h.records.query('papers')).filter((r) => r.recordId === recordId)
  return row.data as unknown as PaperData
}

/** Runs ticks until the job returns without asking to continue. */
async function runJob(paperId: string, arxivId: string) {
  let resumeFrom: AnalyzeState | undefined
  for (let tick = 0; tick < 60; tick++) {
    let next: { state: AnalyzeState; afterMs: number } | null = null
    const jobCtx: JobContext = {
      progress: () => {},
      continue: (state, options) => {
        next = { state: state as AnalyzeState, afterMs: options?.afterMs ?? 0 }
      },
      signal: new AbortController().signal,
    }
    const job = { id: 'job', type: 'analyze', payload: { paperId, arxivId }, resumeFrom } as unknown as Job
    vi.setSystemTime(Date.now() + TICK_MS)
    const result = await runAnalyzeTick(job, jobCtx, env)
    if (!next) return result
    const { state, afterMs } = next as { state: AnalyzeState; afterMs: number }
    vi.setSystemTime(Date.now() + afterMs)
    resumeFrom = state
  }
  throw new Error('the job did not finish in 60 ticks')
}

beforeEach(() => {
  h.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(fixtureIntegration).mockReset()
})

describe('analyze job timings', () => {
  beforeEach(async () => {
    const real = await vi.importActual<typeof import('./fixtures')>('./fixtures')
    vi.mocked(fixtureIntegration).mockImplementation(real.fixtureIntegration)
  })

  it('records every stage back to back, from the request to ready', async () => {
    const id = await createPaper('0000.00001')
    expect(await runJob(id, '0000.00001')).toEqual({ ok: true, arxivId: '0000.00001' })

    const d = await paperData(id)
    expect(d.status).toBe('ready')
    expect(d.retries).toBe(0)
    const t = d.timings!
    expect(Object.keys(t)).toEqual([...TIMED_STAGES])
    expect(openStage(t)).toBeNull()
    expect(t.queued!.startedAt).toBe(START)
    // Each stage starts when the one before it ends, and every stage took at least one tick.
    for (let i = 1; i < TIMED_STAGES.length; i++) {
      expect(t[TIMED_STAGES[i]]!.startedAt).toBe(t[TIMED_STAGES[i - 1]]!.endedAt)
    }
    const { stages, totalMs } = stageDurations(t)
    for (const s of TIMED_STAGES) expect(stages[s]).toBeGreaterThanOrEqual(TICK_MS)
    // The run ends when its last stage (verify) does.
    expect(totalMs).toBe(t.verify!.endedAt! - START)
  })

  it('counts a retried step, and the retry delay stays inside that stage', async () => {
    const real = await vi.importActual<typeof import('./fixtures')>('./fixtures')
    let failed = false
    vi.mocked(fixtureIntegration).mockImplementation((endpoint, body, hint) => {
      if (hint === 'concepts' && !failed) {
        failed = true
        throw new Error('model overloaded')
      }
      return real.fixtureIntegration(endpoint, body, hint)
    })
    const id = await createPaper('0000.00002')
    await runJob(id, '0000.00002')

    const d = await paperData(id)
    expect(d.status).toBe('ready')
    expect(d.retries).toBe(1)
    // The failed tick, the 3 second wait and the successful tick all count toward concepts.
    expect(stageDurations(d.timings).stages.concepts).toBeGreaterThanOrEqual(3000 + 2 * TICK_MS)
  })

  it('a run that fails twice ends the stage it failed in and keeps the retry count', async () => {
    // Fixture ids ending in 77 fail the PDF conversion every time.
    const id = await createPaper('0000.00177')
    expect(await runJob(id, '0000.00177')).toMatchObject({ ok: false })

    const d = await paperData(id)
    expect(d.status).toBe('failed')
    expect(d.retries).toBe(1)
    expect(openStage(d.timings)).toBeNull()
    expect(lastStartedStage(d.timings)).toBe('text')
    expect(d.timings!.concepts).toBeUndefined()
    expect(d.timings!.text!.endedAt).toBe(Date.now())
  })
})

type ConceptRow = { key: string; branchKey: string; quote: string; quoteVerified: boolean; plainRole?: string }

/** The real fixture response for `hint`, with `edit` applied to its JSON. */
async function editedFixture(hint: string, edit: (json: Record<string, unknown>) => void) {
  const real = await vi.importActual<typeof import('./fixtures')>('./fixtures')
  vi.mocked(fixtureIntegration).mockImplementation((endpoint, body, h) => {
    const out = real.fixtureIntegration(endpoint, body, h)
    if (h !== hint) return out
    const json = JSON.parse((out as { content: { text: string }[] }).content[0].text)
    edit(json)
    return { content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn' }
  })
}

async function conceptRows(paperId: string): Promise<Record<string, ConceptRow>> {
  const rows = await h.records.query('concepts', { where: { paperId } })
  return Object.fromEntries(rows.map((r) => [r.data.key as string, r.data as unknown as ConceptRow]))
}

describe('analyze job grounding and placement', () => {
  it('finds a quote in the text for a concept whose candidates all failed, and counts concepts left without one', async () => {
    const real = await vi.importActual<typeof import('./fixtures')>('./fixtures')
    vi.mocked(fixtureIntegration).mockImplementation(real.fixtureIntegration)
    const id = await createPaper('0000.00003')
    await runJob(id, '0000.00003')

    const concepts = await conceptRows(id)
    // c5's only candidate was c1's quote; the sentence naming gradient descent replaces it.
    expect(concepts.c5).toMatchObject({
      quote: 'We assume the reader knows how gradient descent updates parameters by following the negative gradient of a loss.',
      quoteVerified: true,
    })
    expect(concepts.c4).toMatchObject({ quote: '', quoteVerified: false })
    expect((await paperData(id)).conceptsWithoutQuote).toBe(1)
  })

  it('moves a foundation filed in a later branch to the earlier branch that uses it, before saving', async () => {
    // Softmax (c1) filed under geometry: attention needs geometry for c1, and geometry needs attention for c2.
    await editedFixture('concepts', (json) => {
      for (const c of json.concepts as { id: string; branch_key: string }[]) if (c.id === 'c1' || c.id === 'c5') c.branch_key = 'geometry'
    })
    const id = await createPaper('0000.00004')
    await runJob(id, '0000.00004')

    const concepts = await conceptRows(id)
    expect(concepts.c1.branchKey).toBe('attention')
    expect(concepts.c5.branchKey).toBe('geometry')
    expect((await paperData(id)).branches.map((b) => b.key)).toEqual(['attention', 'geometry', 'other'])
    expect(vi.mocked(console.info).mock.calls.flat()).toContain('[analyze] 0000.00004: c1 moved from branch geometry to attention (foundation-to-earlier-user)')
  })
})
