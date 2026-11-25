/**
 * Server actions (POST /api/actions/:name). They run with RBAC off, so each
 * one checks what the caller may do before writing. Paid work happens only in
 * the analyze job, which only these actions enqueue.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ConceptData, Envelope, PaperData, TopicData, WorkspaceData } from '../types'
import { isFixtureId, parseArxivId } from '../lib/arxiv'
import { STARTER_TOPICS } from '../lib/topics'
import { queuedTimings } from '../lib/timings'
import { categoryName, suggestWorkspaceName } from '../lib/categories'
import { lookupArxiv } from '../server/pipeline/arxiv-meta'
import { createPipelineClient, fixturesAllowed, fixtureWorkspace } from '../server/pipeline/client'
import { generateOverview, storedPaperText, type OverviewConcept } from '../server/overview'
import { recommendForWorkspace } from '../server/recommend'
import { generateExplanation } from '../server/explain-concept'
import { loadBranch } from '../server/branch-resources'
import { paperSlot, releaseUsage, reserveUsage, setUsageRef, USAGE_CAPS, usageState, usedRecently } from '../server/usage'
import { enqueueAnalyze, isOwner, startReanalysis, STUCK_AFTER_MS, toMsTime } from '../server/reanalyze'

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

/**
 * Add a paper to a workspace: one row per paper, so parallel adds never drop
 * each other. A paper already in the workspace keeps its row and status.
 */
async function addToWorkspace(
  tools: ActionTools,
  ws: Envelope<WorkspaceData>,
  paper: { paperId: string; arxivId: string; title: string },
) {
  const r = await tools.create('workspace_papers', {
    userId: ws.data.userId,
    workspaceId: ws.recordId,
    paperId: paper.paperId,
    arxivId: paper.arxivId,
    title: paper.title,
    status: 'active',
    addedAt: Date.now(),
  })
  if (!r.success && !/duplicate|unique/i.test(r.error)) throw new Error(r.error)
  await tools.update('workspaces', ws.recordId, { currentPaperId: paper.paperId })
}

/** Look a paper up on arXiv before adding it. Free (public arXiv API), not capped, needs sign-in. */
const peekPaper: ActionHandler<Env> = async ({ params, tools, env }) => {
  const ref = parseArxivId(typeof params.input === 'string' ? params.input : '')
  if (!ref) return fail(INVALID_INPUT)
  const debug = env.ALLOW_DEBUG_ROUTES === 'true'
  if (isFixtureId(ref.id) && !debug) return fail(INVALID_INPUT)
  const existing = await findPaper(tools, ref.id)
  const lookup = await lookupArxiv(ref.id, { fixtures: debug })
  if (!lookup.ok) {
    // An analyzed paper can still be shown if arXiv is briefly unreachable.
    if (!existing || lookup.reason === 'not_found') return fail(lookup.message)
  }
  const meta = lookup.ok ? lookup.meta : null
  const title = meta?.title ?? existing?.data.title ?? ref.id
  const primaryCategory = meta?.primaryCategory ?? existing?.data.primaryCategory ?? ''
  return {
    success: true,
    data: {
      arxivId: ref.id,
      paperId: existing?.recordId ?? '',
      title,
      authors: (meta?.authors ?? existing?.data.authors ?? []).slice(0, 8),
      year: (meta?.publishedAt ?? existing?.data.publishedAt ?? '').slice(0, 4),
      primaryCategory,
      categoryName: categoryName(primaryCategory),
      suggestedWorkspaceName: suggestWorkspaceName(primaryCategory, title),
      analyzed: existing?.data.status === 'ready',
      status: existing?.data.status ?? 'new',
    },
  }
}

/** Create a workspace for the caller (server side, after the paper checked out). */
async function createWorkspace(tools: ActionTools, userId: string, name: string): Promise<Envelope<WorkspaceData> | null> {
  const data: WorkspaceData = {
    userId,
    name: name.trim().slice(0, 120),
    description: '',
    currentPaperId: '',
    papers: [],
    suggestions: [],
    suggestionsAt: 0,
    lastOpenedAt: Date.now(),
  }
  const r = await tools.create('workspaces', data as unknown as Record<string, unknown>)
  if (!r.success) return null
  return { recordId: r.data.recordId, data }
}

interface AnalyzeResult {
  paperId: string
  arxivId: string
  existing: boolean
  status: string
  workspaceId?: string
}

const analyzePaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const ref = parseArxivId(typeof params.input === 'string' ? params.input : '')
  if (!ref) return fail(INVALID_INPUT)
  const debug = env.ALLOW_DEBUG_ROUTES === 'true'
  if (isFixtureId(ref.id) && !debug) return fail(INVALID_INPUT)

  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : ''
  let workspace = workspaceId ? await ownedWorkspace(tools, userId, workspaceId) : null
  if (workspaceId && !workspace) return fail('Workspace not found.')
  const nw = params.newWorkspace as { name?: unknown } | undefined
  const newName = nw && typeof nw.name === 'string' ? nw.name.trim() : ''
  if (nw && !newName) return fail('Give the new workspace a name.')
  if (newName && workspace) return fail('Choose either an existing workspace or a new one.')
  // A new workspace is created only once the paper has checked out, so a bad link never leaves an empty one.
  const ensureWorkspace = async () => {
    if (!newName || workspace) return workspace
    workspace = await createWorkspace(tools, userId, newName)
    return workspace
  }

  const existing = await findPaper(tools, ref.id)
  if (existing) {
    const ws = await ensureWorkspace()
    if (newName && !ws) return fail('Could not create the workspace.')
    if (ws) await addToWorkspace(tools, ws, { paperId: existing.recordId, arxivId: ref.id, title: existing.data.title })
    return {
      success: true,
      data: { paperId: existing.recordId, arxivId: ref.id, existing: true, status: existing.data.status, workspaceId: ws?.recordId } satisfies AnalyzeResult,
    }
  }

  // Reserve the daily slot before anything else, so parallel requests cannot all pass the cap.
  const slot = await reserveUsage(tools, userId, 'analyze', `pending:${ref.id}`)
  if (!slot.ok) return fail(slot.message)
  const giveBack = async <T,>(result: T): Promise<T> => {
    await releaseUsage(tools, slot.id)
    return result
  }

  const lookup = await lookupArxiv(ref.id, { fixtures: debug })
  if (!lookup.ok) return giveBack(fail(lookup.message))
  const m = lookup.meta
  if (newName && !(await ensureWorkspace())) return giveBack(fail('Could not create the workspace.'))

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
    timings: queuedTimings(Date.now()),
    retries: 0,
  })
  if (!created.success) {
    // Someone else started the same paper a moment ago (uniqueOn arxivId).
    const raced = await findPaper(tools, ref.id)
    await releaseUsage(tools, slot.id)
    if (raced) {
      if (workspace) await addToWorkspace(tools, workspace, { paperId: raced.recordId, arxivId: ref.id, title: raced.data.title })
      return { success: true, data: { paperId: raced.recordId, arxivId: ref.id, existing: true, status: raced.data.status, workspaceId: workspace?.recordId } }
    }
    return fail(created.error)
  }

  const paperId = created.data.recordId
  // The usage event is the server-only record of who requested the paper.
  await setUsageRef(tools, slot.id, paperId)
  try {
    await enqueueAnalyze(env, paperId, ref.id, userId)
  } catch (e) {
    await releaseUsage(tools, slot.id)
    await tools.update('papers', paperId, {
      status: 'failed',
      stage: 'failed',
      error: `Could not start the analysis: ${e instanceof Error ? e.message : String(e)}`,
    })
    return fail('Could not start the analysis. Try again.')
  }
  if (workspace) await addToWorkspace(tools, workspace, { paperId, arxivId: ref.id, title: m.title })
  console.info(`[analyzePaper] queued ${ref.id} for ${userId} (${slot.state.used} in the last 24h)`)
  return { success: true, data: { paperId, arxivId: ref.id, existing: false, status: 'queued', workspaceId: workspace?.recordId } satisfies AnalyzeResult }
}

const retryPaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  if (!paperId) return fail('Missing paperId.')
  const got = await tools.get('papers', paperId)
  if (!got.success) return fail('Paper not found.')
  const paper = (got.data as unknown as { record: Envelope<PaperData> }).record
  const stuck =
    (paper.data.status === 'processing' || paper.data.status === 'queued') &&
    Date.now() - toMsTime(paper.updatedAt) > STUCK_AFTER_MS
  if (paper.data.status !== 'failed' && !stuck) return fail('This paper is not in a failed state.')

  // Any signed-in reader may retry; the retry uses one of the retrier's daily papers.
  const slot = await reserveUsage(tools, userId, 'analyze', paperId)
  if (!slot.ok) return fail(slot.message)

  // A retry is a new run: its timings and retry count start over.
  await tools.update('papers', paperId, {
    status: 'queued',
    stage: 'queued',
    error: '',
    progress: 0,
    progressMessage: 'Waiting to start',
    timings: queuedTimings(Date.now()),
    retries: 0,
  })
  try {
    await enqueueAnalyze(env, paperId, paper.data.arxivId, userId)
  } catch {
    await releaseUsage(tools, slot.id)
    await tools.update('papers', paperId, { status: 'failed', stage: 'failed', error: 'Could not restart the analysis.' })
    return fail('Could not restart the analysis. Try again.')
  }
  return { success: true, data: { paperId } }
}

/** Re-runs the analysis of a paper with the current pipeline. App owner only; see server/reanalyze.ts. */
const reanalyzePaper: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!isOwner(env, userId)) return fail('Only the app owner can re-analyze a paper.')
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  const ref = parseArxivId(typeof params.arxivId === 'string' ? params.arxivId : typeof params.input === 'string' ? params.input : '')
  if (!paperId && !ref) return fail('Give the paper as arxivId or paperId.')
  let paper: Envelope<PaperData> | null = null
  if (paperId) {
    const got = await tools.get('papers', paperId)
    paper = got.success ? (got.data as unknown as { record: Envelope<PaperData> }).record : null
  } else if (ref) {
    paper = await findPaper(tools, ref.id)
  }
  if (!paper) return fail('Paper not found.')
  const r = await startReanalysis(env, userId, paper, (id, data) => tools.update('papers', id, data))
  if (!r.ok) return fail(r.error)
  return { success: true, data: { paperId: r.paperId, arxivId: r.arxivId, status: 'queued' } }
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
  // Fixture runs in local tests cost nothing, so they neither count nor stop at the cap.
  const free = fixtureWorkspace(env, ws.data.name)
  const slot = free ? null : await reserveUsage(tools, userId, 'recommend', ws.recordId)
  if (slot && !slot.ok) return fail(slot.message)

  const mode = params.mode === 'starter' ? 'starter' : 'next'
  const outcome = await recommendForWorkspace(env, tools, userId, ws, mode)
  // A search that ran was paid for, so it counts toward the cap even if nothing usable came back.
  if (slot?.ok && !outcome.charged) await releaseUsage(tools, slot.id)
  if (!outcome.ok) return fail(outcome.error)

  await tools.update('workspaces', ws.recordId, { suggestions: outcome.suggestions, suggestionsAt: Date.now() })
  return { success: true, data: { suggestions: outcome.suggestions, remaining: slot?.ok ? slot.state.remaining : USAGE_CAPS.recommend } }
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

  const paperRes = await tools.get('papers', concept.data.paperId)
  if (!paperRes.success) return fail('Paper not found.')
  const paper = (paperRes.data as unknown as { record: Envelope<PaperData> }).record
  // Someone else is generating this explanation right now; it will arrive on the concept.
  const pendingAt = concept.data.explanationPendingAt ?? 0
  if (pendingAt && Date.now() - pendingAt < EXPLAIN_PENDING_MS) return { success: true, data: { pending: true } }

  const free = fixturesAllowed(env, paper.data.arxivId)
  const slot = free ? null : await reserveUsage(tools, userId, 'explain', conceptId)
  if (slot && !slot.ok) return fail(slot.message)

  await tools.update('concepts', conceptId, { explanationPendingAt: Date.now() })
  let explanation: string
  try {
    explanation = await generateExplanation(env, concept, paper)
  } catch (e) {
    // The model call was made, so the slot stays used.
    await tools.update('concepts', conceptId, { explanationPendingAt: 0 })
    return fail(`Could not generate an explanation: ${e instanceof Error ? e.message : String(e)}`)
  }
  await tools.update('concepts', conceptId, { explanation, explanationAt: Date.now(), explanationPendingAt: 0 })
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
  const free = fixturesAllowed(env, paper.data.arxivId)
  const alreadyCounted = await usedRecently(tools, userId, 'branch', ref)
  const slot = free || alreadyCounted ? null : await reserveUsage(tools, userId, 'branch', ref)
  if (slot && !slot.ok) return fail(slot.message)

  const outcome = await loadBranch(env, tools, paper, branchKey)
  // Paid calls that ran count even when the load then failed; a load that cost nothing gives the slot back.
  const charged = outcome.ok ? outcome.charged : outcome.charged === true
  if (slot?.ok && !charged) await releaseUsage(tools, slot.id)
  if (!outcome.ok) return fail(outcome.error)
  const left = (await usageState(tools, userId, 'branch')).remaining
  return {
    success: true,
    data: { loaded: outcome.loaded, failed: outcome.failed, remaining: outcome.remaining, busy: outcome.busy, allowanceLeft: left },
  }
}

/** A run that started this recently is still in progress; an older mark is treated as abandoned. */
const OVERVIEW_PENDING_MS = 2 * 60_000
const EXPLAIN_PENDING_MS = 2 * 60_000

/**
 * The paper overview for a paper analyzed before the overview stage existed:
 * generated once, cached on the paper, free for everyone after that. The
 * plain role of each concept is stored on the concept.
 */
const ensureOverview: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  if (!paperId) return fail('Missing paperId.')
  const got = await tools.get('papers', paperId)
  if (!got.success) return fail('Paper not found.')
  const paper = (got.data as unknown as { record: Envelope<PaperData> }).record
  if (paper.data.overview) return { success: true, data: { overview: paper.data.overview, cached: true } }
  if (paper.data.status !== 'ready') return fail('The paper is not analyzed yet.')
  if (paper.data.overviewLoadingAt && Date.now() - paper.data.overviewLoadingAt < OVERVIEW_PENDING_MS) {
    return { success: true, data: { pending: true } }
  }

  const free = fixturesAllowed(env, paper.data.arxivId)
  const slot = free ? null : await reserveUsage(tools, userId, 'overview', paperId)
  if (slot && !slot.ok) return fail(slot.message)

  await tools.update('papers', paperId, { overviewLoadingAt: Date.now() })
  const conceptsRes = await tools.query('concepts', { where: { paperId }, limit: 200 })
  if (!conceptsRes.success) return fail(conceptsRes.error)
  const concepts = conceptsRes.data.records as unknown as Envelope<ConceptData>[]

  let result
  try {
    const text = await storedPaperText(env, paper, free)
    const ordered: OverviewConcept[] = concepts.map((c) => ({
      key: c.data.key,
      name: c.data.name,
      whyNeeded: c.data.whyNeeded,
      section: c.data.section,
      order: c.data.order,
      quote: c.data.quoteVerified ? c.data.quote : '',
    }))
    result = await generateOverview(createPipelineClient(env, free), paper.data, text, ordered, { source: paper.data.textSource ?? 'pdf' })
  } catch (e) {
    await tools.update('papers', paperId, { overviewLoadingAt: 0 })
    return fail(`Could not write the overview: ${e instanceof Error ? e.message : String(e)}`)
  }
  for (const c of concepts) {
    if (result.roles[c.data.key]) await tools.update('concepts', c.recordId, { plainRole: result.roles[c.data.key] })
  }
  await tools.update('papers', paperId, { overview: result.overview, overviewLoadingAt: 0 })
  return { success: true, data: { overview: result.overview, cached: false } }
}

/** The caller's remaining daily allowances. No paid calls. */
const myAllowance: ActionHandler<Env> = async ({ userId, tools }) => {
  const [analyze, recommend, explain, branch, overview] = await Promise.all([
    usageState(tools, userId, 'analyze'),
    usageState(tools, userId, 'recommend'),
    usageState(tools, userId, 'explain'),
    usageState(tools, userId, 'branch'),
    usageState(tools, userId, 'overview'),
  ])
  return { success: true, data: { analyze, recommend, explain, branch, overview } }
}

/** Whether the caller's latest request of a failed paper still uses a daily slot or was given back. No paid calls. */
const myPaperSlot: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const paperId = typeof params.paperId === 'string' ? params.paperId : ''
  if (!paperId) return fail('Missing paperId.')
  return { success: true, data: { slot: await paperSlot(tools, userId, paperId) } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  myAllowance,
  myPaperSlot,
  peekPaper,
  analyzePaper,
  retryPaper,
  reanalyzePaper,
  seedTopics,
  recommendPapers,
  explainConcept,
  loadBranchResources,
  ensureOverview,
}
