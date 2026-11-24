/**
 * Server actions (POST /api/actions/:name). They run with RBAC off, so each
 * one checks what the caller may do before writing. Paid work happens only in
 * the analyze job, which only these actions enqueue.
 */

import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ConceptData, Envelope, PaperData, TopicData, WorkspaceData } from '../types'
import { isFixtureId, parseArxivId } from '../lib/arxiv'
import { STARTER_TOPICS } from '../lib/topics'
import { withPaper } from '../lib/workspace'
import { lookupArxiv } from '../server/pipeline/arxiv-meta'
import { recommendForWorkspace } from '../server/recommend'
import { generateExplanation } from '../server/explain-concept'
import { loadBranch } from '../server/branch-resources'
import { actionRecords, capMessage, paperRequesters, recordUsage, refundAnalyze, usageState, usedRecently } from '../server/usage'

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

async function ownedWorkspace(tools: ActionTools, userId: string, workspaceId: string): Promise<Envelope<WorkspaceData> | null> {
  if (!workspaceId) return null
  const r = await tools.get('workspaces', workspaceId)
  if (!r.success) return null
  const ws = (r.data as unknown as { record: Envelope<WorkspaceData> }).record
  return ws && ws.data.userId === userId ? ws : null
}

/** Add a paper to a workspace (any number of papers; existing entries keep their status). */
async function addToWorkspace(
  tools: ActionTools,
  ws: Envelope<WorkspaceData>,
  paper: { paperId: string; arxivId: string; title: string },
) {
  await tools.update('workspaces', ws.recordId, {
    currentPaperId: paper.paperId,
    papers: withPaper(ws.data.papers, paper, Date.now()),
  })
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

  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : ''
  const workspace = workspaceId ? await ownedWorkspace(tools, userId, workspaceId) : null
  if (workspaceId && !workspace) return fail('Workspace not found.')

  const existing = await findPaper(tools, ref.id)
  if (existing) {
    if (workspace) await addToWorkspace(tools, workspace, { paperId: existing.recordId, arxivId: ref.id, title: existing.data.title })
    return {
      success: true,
      data: { paperId: existing.recordId, arxivId: ref.id, existing: true, status: existing.data.status } satisfies AnalyzeResult,
    }
  }

  const cap = await usageState(tools, userId, 'analyze')
  if (!cap.allowed) return fail(capMessage('analyze', cap))

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
    branches: [],
  })
  if (!created.success) {
    // Someone else started the same paper a moment ago (uniqueOn arxivId).
    const raced = await findPaper(tools, ref.id)
    if (raced) {
      if (workspace) await addToWorkspace(tools, workspace, { paperId: raced.recordId, arxivId: ref.id, title: raced.data.title })
      return { success: true, data: { paperId: raced.recordId, arxivId: ref.id, existing: true, status: raced.data.status } }
    }
    return fail(created.error)
  }

  const paperId = created.data.recordId
  // The usage event is the server-only record of who requested the paper.
  await recordUsage(tools, userId, 'analyze', paperId)
  try {
    await enqueueAnalyze(env, paperId, ref.id, userId)
  } catch (e) {
    await refundAnalyze(actionRecords(tools), paperId)
    await tools.update('papers', paperId, {
      status: 'failed',
      stage: 'failed',
      error: `Could not start the analysis: ${e instanceof Error ? e.message : String(e)}`,
    })
    return fail('Could not start the analysis. Try again.')
  }
  if (workspace) await addToWorkspace(tools, workspace, { paperId, arxivId: ref.id, title: m.title })
  console.info(`[analyzePaper] queued ${ref.id} for ${userId} (${cap.used + 1} in the last 24h)`)
  return { success: true, data: { paperId, arxivId: ref.id, existing: false, status: 'queued' } satisfies AnalyzeResult }
}

const retryPaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  if (!paperId) return fail('Missing paperId.')
  const got = await tools.get('papers', paperId)
  if (!got.success) return fail('Paper not found.')
  const paper = (got.data as unknown as { record: Envelope<PaperData> }).record
  const requesters = await paperRequesters(tools, paperId)
  if (!requesters.has(userId) && userId !== env.OWNER_USER_ID) {
    return fail('Only the person who started this paper can retry it.')
  }
  const stuck =
    (paper.data.status === 'processing' || paper.data.status === 'queued') &&
    Date.now() - toMsTime(paper.updatedAt) > STUCK_AFTER_MS
  if (paper.data.status !== 'failed' && !stuck) return fail('This paper is not in a failed state.')

  // A retry uses a daily slot again; a stuck run's slot is given back first.
  await refundAnalyze(actionRecords(tools), paperId)
  const cap = await usageState(tools, userId, 'analyze')
  if (!cap.allowed) return fail(capMessage('analyze', cap))
  await recordUsage(tools, userId, 'analyze', paperId)

  await tools.update('papers', paperId, { status: 'queued', stage: 'queued', error: '', progress: 0, progressMessage: 'Waiting to start' })
  try {
    await enqueueAnalyze(env, paperId, paper.data.arxivId, userId)
  } catch {
    await refundAnalyze(actionRecords(tools), paperId)
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
      resourcesLoadingAt: 0,
      origin: 'starter',
    })
  }
  return { success: true, data: { remaining: Math.max(0, missing.length - SEED_BATCH) } }
}

const recommendPapers: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const ws = await ownedWorkspace(tools, userId, typeof params.workspaceId === 'string' ? params.workspaceId : '')
  if (!ws) return fail('Workspace not found.')
  const usage = await usageState(tools, userId, 'recommend')
  if (!usage.allowed) return fail(capMessage('recommend', usage))

  const outcome = await recommendForWorkspace(env, tools, userId, ws)
  // A search that ran was paid for, so it counts toward the cap even if nothing usable came back.
  if (outcome.ok || outcome.charged) await recordUsage(tools, userId, 'recommend', ws.recordId)
  if (!outcome.ok) return fail(outcome.error)

  await tools.update('workspaces', ws.recordId, { suggestions: outcome.suggestions, suggestionsAt: Date.now() })
  return { success: true, data: { suggestions: outcome.suggestions, remaining: usage.remaining - 1 } }
}

const explainConcept: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const conceptId = typeof params.conceptId === 'string' ? params.conceptId : ''
  if (!conceptId) return fail('Missing conceptId.')
  const got = await tools.get('concepts', conceptId)
  if (!got.success) return fail('Concept not found.')
  const concept = (got.data as unknown as { record: Envelope<ConceptData> }).record
  if (concept.data.explanation) {
    return { success: true, data: { explanation: concept.data.explanation, cached: true } }
  }

  const usage = await usageState(tools, userId, 'explain')
  if (!usage.allowed) return fail(capMessage('explain', usage))

  const paperRes = await tools.get('papers', concept.data.paperId)
  if (!paperRes.success) return fail('Paper not found.')
  const paper = (paperRes.data as unknown as { record: Envelope<PaperData> }).record

  let explanation: string
  try {
    explanation = await generateExplanation(env, concept, paper)
  } catch (e) {
    return fail(`Could not generate an explanation: ${e instanceof Error ? e.message : String(e)}`)
  }
  await tools.update('concepts', conceptId, { explanation, explanationAt: Date.now() })
  await recordUsage(tools, userId, 'explain', conceptId)
  return { success: true, data: { explanation, cached: false } }
}

const loadBranchResources: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  const branchKey = typeof params.branchKey === 'string' ? params.branchKey : ''
  if (!paperId || !branchKey) return fail('Missing paperId or branchKey.')
  const got = await tools.get('papers', paperId)
  if (!got.success) return fail('Paper not found.')
  const paper = (got.data as unknown as { record: Envelope<PaperData> }).record
  if (!(paper.data.branches ?? []).some((b) => b.key === branchKey)) return fail('Branch not found.')

  // Loading the rest of a branch already counted today is free.
  const ref = `${paperId}:${branchKey}`
  const alreadyCounted = await usedRecently(tools, userId, 'branch', ref)
  const usage = await usageState(tools, userId, 'branch')
  if (!alreadyCounted && !usage.allowed) return fail(capMessage('branch', usage))

  const outcome = await loadBranch(env, tools, paper, branchKey)
  if (!outcome.ok) return fail(outcome.error)
  if (outcome.charged && !alreadyCounted) await recordUsage(tools, userId, 'branch', ref)
  return {
    success: true,
    data: {
      loaded: outcome.loaded,
      failed: outcome.failed,
      remaining: outcome.remaining,
      busy: outcome.busy,
      allowanceLeft: outcome.charged && !alreadyCounted ? usage.remaining - 1 : usage.remaining,
    },
  }
}

/** The caller's remaining daily allowances. No paid calls. */
const myAllowance: ActionHandler<Env> = async ({ userId, tools }) => {
  const [analyze, recommend, explain, branch] = await Promise.all([
    usageState(tools, userId, 'analyze'),
    usageState(tools, userId, 'recommend'),
    usageState(tools, userId, 'explain'),
    usageState(tools, userId, 'branch'),
  ])
  return { success: true, data: { analyze, recommend, explain, branch } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  myAllowance,
  analyzePaper,
  retryPaper,
  seedTopics,
  recommendPapers,
  explainConcept,
  loadBranchResources,
}
