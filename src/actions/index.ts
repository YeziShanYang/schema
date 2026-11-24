/**
 * Server actions (POST /api/actions/:name). They run with RBAC off, so each
 * one checks what the caller may do before writing. Paid work happens only in
 * the analyze job, which only these actions enqueue.
 */

import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, PaperData, TopicData } from '../types'
import { isFixtureId, parseArxivId } from '../lib/arxiv'
import { capState, DAILY_PAPER_CAP } from '../lib/cap'
import { STARTER_TOPICS } from '../lib/topics'
import { lookupArxiv } from '../server/pipeline/arxiv-meta'

/** Every continue counts as a JobRoom attempt; this leaves room for all ticks plus crash recovery. */
const ANALYZE_MAX_ATTEMPTS = 60
/** A paper still "processing" after this long is treated as stuck and can be retried. */
const STUCK_AFTER_MS = 20 * 60 * 1000
const SEED_BATCH = 20

const fail = (error: string): ActionResult<never> => ({ success: false, error })

const INVALID_INPUT =
  'That does not look like an arXiv link or id. Try something like 2611.29224 or https://arxiv.org/abs/2611.29224.'

async function findPaper(tools: ActionTools, arxivId: string): Promise<Envelope<PaperData> | null> {
  const r = await tools.query('papers', { where: { arxivId }, limit: 1 })
  if (!r.success) throw new Error(r.error)
  return ((r.data.records as unknown as Envelope<PaperData>[])[0] as Envelope<PaperData> | undefined) ?? null
}

function toMsTime(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') return Date.parse(v) || 0
  return 0
}

function enqueueAnalyze(env: Env, paperId: string, arxivId: string, userId: string) {
  return enqueueJob(
    env.JOB_ROOMS,
    `app:${env.DEEPSPACE_APP_ID}`,
    'analyze',
    { paperId, arxivId },
    { maxAttempts: ANALYZE_MAX_ATTEMPTS, enqueuedBy: userId },
  )
}

interface AnalyzeResult {
  paperId: string
  arxivId: string
  existing: boolean
  status: string
}

const analyzePaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const ref = parseArxivId(typeof params.input === 'string' ? params.input : '')
  if (!ref) return fail(INVALID_INPUT)
  const debug = env.ALLOW_DEBUG_ROUTES === 'true'
  if (isFixtureId(ref.id) && !debug) return fail(INVALID_INPUT)

  const existing = await findPaper(tools, ref.id)
  if (existing) {
    return {
      success: true,
      data: { paperId: existing.recordId, arxivId: ref.id, existing: true, status: existing.data.status } satisfies AnalyzeResult,
    }
  }

  const mine = await tools.query('papers', {
    where: { requestedBy: userId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 25,
  })
  if (!mine.success) return fail(mine.error)
  const cap = capState(
    (mine.data.records as unknown as Envelope<PaperData>[]).map((r) => r.createdAt),
    Date.now(),
  )
  if (!cap.allowed) {
    const when = new Date(cap.nextSlotAt).toISOString().slice(11, 16)
    return fail(
      `You have started ${DAILY_PAPER_CAP} new papers in the last 24 hours, the daily limit. You can start another after ${when} UTC. Papers someone already analyzed are always free to open.`,
    )
  }

  const lookup = await lookupArxiv(ref.id, { fixtures: debug })
  if (!lookup.ok) return fail(lookup.message)
  const m = lookup.meta

  const created = await tools.create('papers', {
    arxivId: ref.id,
    version: m.version,
    title: m.title,
    authors: m.authors,
    abstract: m.abstract,
    primaryCategory: m.primaryCategory,
    publishedAt: m.publishedAt,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    progressMessage: 'Waiting to start',
    error: '',
    mainContribution: '',
    textChars: 0,
    textKey: '',
    conceptCount: 0,
    requestedBy: userId,
  })
  if (!created.success) {
    // Someone else started the same paper a moment ago (uniqueOn arxivId).
    const raced = await findPaper(tools, ref.id)
    if (raced) {
      return { success: true, data: { paperId: raced.recordId, arxivId: ref.id, existing: true, status: raced.data.status } }
    }
    return fail(created.error)
  }

  const paperId = created.data.recordId
  try {
    await enqueueAnalyze(env, paperId, ref.id, userId)
  } catch (e) {
    await tools.update('papers', paperId, {
      status: 'failed',
      stage: 'failed',
      error: `Could not start the analysis: ${e instanceof Error ? e.message : String(e)}`,
    })
    return fail('Could not start the analysis. Try again.')
  }
  console.info(`[analyzePaper] queued ${ref.id} for ${userId} (${cap.used + 1}/${DAILY_PAPER_CAP} today)`)
  return { success: true, data: { paperId, arxivId: ref.id, existing: false, status: 'queued' } satisfies AnalyzeResult }
}

const retryPaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  if (!paperId) return fail('Missing paperId.')
  const got = await tools.get('papers', paperId)
  if (!got.success) return fail('Paper not found.')
  const paper = (got.data as unknown as { record: Envelope<PaperData> }).record
  if (paper.data.requestedBy !== userId && userId !== env.OWNER_USER_ID) {
    return fail('Only the person who started this paper can retry it.')
  }
  const stuck =
    (paper.data.status === 'processing' || paper.data.status === 'queued') &&
    Date.now() - toMsTime(paper.updatedAt) > STUCK_AFTER_MS
  if (paper.data.status !== 'failed' && !stuck) return fail('This paper is not in a failed state.')

  await tools.update('papers', paperId, { status: 'queued', stage: 'queued', error: '', progress: 0, progressMessage: 'Waiting to start' })
  try {
    await enqueueAnalyze(env, paperId, paper.data.arxivId, userId)
  } catch {
    await tools.update('papers', paperId, { status: 'failed', stage: 'failed', error: 'Could not restart the analysis.' })
    return fail('Could not restart the analysis. Try again.')
  }
  return { success: true, data: { paperId } }
}

/** Creates any missing starter topics, a batch at a time. Idempotent; call until remaining is 0. */
const seedTopics: ActionHandler<Env> = async ({ tools }) => {
  const r = await tools.query('topics', { where: { origin: 'starter' }, limit: 200 })
  if (!r.success) return fail(r.error)
  const have = new Set((r.data.records as unknown as Envelope<TopicData>[]).map((t) => t.data.key))
  const missing = STARTER_TOPICS.filter((t) => !have.has(t.key))
  for (const t of missing.slice(0, SEED_BATCH)) {
    await tools.create('topics', {
      ...t,
      searchQuery: `${t.name} tutorial for beginners`,
      resources: [],
      resourcesStatus: 'none',
      origin: 'starter',
    })
  }
  return { success: true, data: { remaining: Math.max(0, missing.length - SEED_BATCH) } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  analyzePaper,
  retryPaper,
  seedTopics,
}
