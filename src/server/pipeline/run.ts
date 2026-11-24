/**
 * The `analyze` background job: one paper from arXiv PDF to a finished
 * roadmap. It runs as a sequence of short ticks, each saved with
 * `ctx.continue`, so no single run comes near the Worker subrequest limit and
 * a restart resumes from the last checkpoint instead of starting over.
 *
 * Steps: seed starter topics -> text -> concepts -> resources (chunked) ->
 * explain -> finish. Record writes produced by a step are queued in the
 * checkpoint and flushed WRITES_PER_TICK at a time before the next step runs.
 *
 * Failures never throw out of the handler. A failing step is retried once
 * after a short delay; a second failure marks the paper failed with a message
 * the page can show. (JobRoom counts every `continue` as an attempt, so its
 * own maxAttempts cannot serve as a per-step retry budget.)
 */

import { appFiles } from 'deepspace/worker'
import type { CronContext, Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import type { ConceptDepth, Envelope, PaperData, TopicData, TopicLevel, TopicResource } from '../../types'
import { arxivPdfUrl, arxivSlug } from '../../lib/arxiv'
import { preparePaperText } from '../../lib/paper-text'
import { normalizeForMatch, isQuoteVerified } from '../../lib/quotes'
import { cleanGraph } from '../../lib/graph'
import { asString, asStringArray } from '../../lib/json'
import { normalizeLevel, normalizeTopicKey, STARTER_TOPICS } from '../../lib/topics'
import { cleanBranches } from '../../lib/branches'
import { createPipelineClient, fixturesAllowed, ownerContext } from './client'
import type { PipelineClient } from './client'
import { callModelJson } from './llm'
import {
  CONCEPTS_SYSTEM,
  conceptsUser,
  EXPLAIN_SYSTEM,
  explainUser,
  RESOURCES_SYSTEM,
  resourcesUser,
  type Candidate,
} from './prompts'

export interface AnalyzePayload {
  paperId: string
  arxivId: string
}

type Step = 'seed' | 'text' | 'concepts' | 'resources' | 'explain' | 'finish'

interface PendingWrite {
  op: 'create' | 'update' | 'delete'
  collection: string
  recordId?: string
  data?: Record<string, unknown>
  /** Treat a uniqueOn refusal as success (idempotent creates). */
  ignoreDuplicate?: boolean
}

interface TopicInfo {
  name: string
  description: string
  searchQuery: string
}

export interface AnalyzeState {
  step: Step
  text: string
  writes: PendingWrite[]
  topicQueue: string[]
  topicTotal: number
  topicInfo: Record<string, TopicInfo>
  failures: number
  exaFailures: number
}

const WRITES_PER_TICK = 20
const TOPICS_PER_TICK = 5
const MAX_CONCEPTS = 22
const MAX_TOPICS_IN_PROMPT = 400
const MIN_TEXT_CHARS = 1500

class PermanentError extends Error {}

function initialState(): AnalyzeState {
  return { step: 'seed', text: '', writes: [], topicQueue: [], topicTotal: 0, topicInfo: {}, failures: 0, exaFailures: 0 }
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/insufficient_credits|insufficient credits/i.test(m)) {
    return 'The app is out of DeepSpace credits, so this paper could not be analyzed.'
  }
  return m.length > 300 ? `${m.slice(0, 300)}…` : m
}

export async function runAnalyzeTick(job: Job, jobCtx: JobContext, env: Env): Promise<unknown> {
  const payload = job.payload as AnalyzePayload
  const state: AnalyzeState = { ...initialState(), ...((job.resumeFrom as AnalyzeState | undefined) ?? {}) }
  const ctx = ownerContext(env)
  const paper = await loadPaper(ctx, payload.arxivId)
  if (!paper) return { skipped: 'paper_missing' }

  if (jobCtx.signal.aborted) {
    await updatePaper(ctx, paper.recordId, { status: 'failed', stage: 'failed', error: 'Analysis was canceled.' })
    return { canceled: true }
  }

  // Steps work on a copy, so a failure part-way through leaves the last good
  // checkpoint intact. Every queued write is idempotent, so re-running a
  // partly flushed batch is safe.
  const next: AnalyzeState = structuredClone(state)
  try {
    if (next.writes.length > 0) {
      await flushWrites(ctx, next)
    } else {
      const client = createPipelineClient(env, fixturesAllowed(env, payload.arxivId), ctx)
      const done = await runStep(next, { env, ctx, client, paper, jobCtx })
      if (done) return { ok: true, arxivId: payload.arxivId }
    }
    next.failures = 0
    jobCtx.continue(next, { afterMs: 0 })
    return
  } catch (e) {
    const message = errMsg(e)
    console.error(`[analyze] ${payload.arxivId} step=${state.step} failed: ${message}`)
    state.failures += 1
    if (!(e instanceof PermanentError) && state.failures < 2) {
      await updatePaper(ctx, paper.recordId, { progressMessage: `Retrying after an error: ${message}` })
      jobCtx.continue(state, { afterMs: 3000 })
      return
    }
    await updatePaper(ctx, paper.recordId, { status: 'failed', stage: 'failed', error: message, progressMessage: '' })
    return { ok: false, error: message }
  }
}

interface StepCtx {
  env: Env
  ctx: CronContext
  client: PipelineClient
  paper: Envelope<PaperData>
  jobCtx: JobContext
}

/** Runs the current step. Returns true when the whole job is finished. */
async function runStep(state: AnalyzeState, s: StepCtx): Promise<boolean> {
  switch (state.step) {
    case 'seed':
      await stepSeed(state, s)
      return false
    case 'text':
      await stepText(state, s)
      return false
    case 'concepts':
      await stepConcepts(state, s)
      return false
    case 'resources':
      await stepResources(state, s)
      return false
    case 'explain':
      await stepExplain(state, s)
      return false
    case 'finish':
      await updatePaper(s.ctx, s.paper.recordId, {
        status: 'ready',
        stage: 'ready',
        progress: 1,
        progressMessage: '',
        error: '',
      })
      return true
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepSeed(state: AnalyzeState, { ctx, paper }: StepCtx) {
  await updatePaper(ctx, paper.recordId, { status: 'processing', stage: 'text', progress: 0.05, progressMessage: 'Preparing', error: '' })
  const existing = (await ctx.records.query('topics', { where: { origin: 'starter' }, limit: 200 })) as Envelope<TopicData>[]
  const have = new Set(existing.map((t) => t.data.key))
  for (const t of STARTER_TOPICS) {
    if (have.has(t.key)) continue
    state.writes.push({
      op: 'create',
      collection: 'topics',
      ignoreDuplicate: true,
      data: { ...t, searchQuery: `${t.name} tutorial for beginners`, resources: [], resourcesStatus: 'none', origin: 'starter' },
    })
  }
  state.step = 'text'
}

async function stepText(state: AnalyzeState, { env, ctx, client, paper, jobCtx }: StepCtx) {
  await updatePaper(ctx, paper.recordId, { stage: 'text', progress: 0.1, progressMessage: 'Converting the PDF to text' })
  let raw = ''
  const files = appFiles(env, { scope: 'app', userId: env.OWNER_USER_ID })

  // A retry of a failed paper reuses the text saved by an earlier run.
  if (paper.data.textKey && !client.fixtures) {
    try {
      const res = await files.download(paper.data.textKey)
      raw = await res.text()
    } catch {
      raw = ''
    }
  }

  if (!raw) {
    const conv = (await client.call(
      'cloudconvert/convert-file',
      { input_format: 'pdf', output_format: 'txt', url: arxivPdfUrl(paper.data.arxivId) },
      'text',
    )) as { downloadUrl?: string; url?: string } | null
    const url = conv?.downloadUrl ?? conv?.url
    if (!url) throw new Error('The PDF converter did not return a file.')
    raw = await client.fetchText(url, jobCtx.signal)
  }

  const prepared = preparePaperText(raw)
  if (prepared.text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
    throw new PermanentError('This PDF has almost no extractable text (it may be a scanned image).')
  }

  let textKey = paper.data.textKey || ''
  if (!client.fixtures && !textKey) {
    try {
      const file = await files.upload(new Blob([prepared.text], { type: 'text/plain' }), {
        key: `papers/${arxivSlug(paper.data.arxivId)}.txt`,
        name: `${arxivSlug(paper.data.arxivId)}.txt`,
      })
      textKey = file.key
    } catch (e) {
      // Storage is a cache for retries; the pipeline continues without it.
      console.warn(`[analyze] could not store text for ${paper.data.arxivId}: ${errMsg(e)}`)
    }
  }

  state.text = prepared.text
  state.step = 'concepts'
  await updatePaper(ctx, paper.recordId, {
    stage: 'concepts',
    progress: 0.2,
    textChars: prepared.text.length,
    textKey,
    progressMessage: prepared.truncated
      ? 'Finding concepts (long paper: only the first part of the main text is used)'
      : 'Finding the concepts this paper relies on',
  })
}

interface ParsedConcept {
  id: string
  name: string
  whyNeeded: string
  section: string
  quote: string
  dependsOn: string[]
  depth: ConceptDepth
  branchKey: string
  topic: Record<string, unknown>
}

function parseConcepts(json: Record<string, unknown>): ParsedConcept[] {
  const list = Array.isArray(json.concepts) ? json.concepts : []
  const out: ParsedConcept[] = []
  for (const item of list.slice(0, MAX_CONCEPTS)) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const name = asString(c.name, 200)
    const id = asString(c.id, 20)
    if (!name || !id) continue
    const depth = c.depth === 'skim' || c.depth === 'deep' ? c.depth : 'working'
    out.push({
      id,
      name,
      whyNeeded: asString(c.why_needed, 600),
      section: asString(c.section, 200),
      quote: asString(c.quote, 600),
      dependsOn: asStringArray(c.depends_on, 20),
      depth,
      branchKey: asString(c.branch_key, 80),
      topic: c.topic && typeof c.topic === 'object' ? (c.topic as Record<string, unknown>) : {},
    })
  }
  return out
}

async function stepConcepts(state: AnalyzeState, { ctx, client, paper }: StepCtx) {
  const topics = (await ctx.records.query('topics', { limit: 1000 })) as Envelope<TopicData>[]
  const byKey = new Map(topics.map((t) => [t.data.key, t]))
  const promptTopics = [...topics]
    .sort((a, b) => (a.data.origin === b.data.origin ? 0 : a.data.origin === 'starter' ? -1 : 1))
    .slice(0, MAX_TOPICS_IN_PROMPT)
    .map((t) => ({ key: t.data.key, name: t.data.name }))

  const json = await callModelJson(client, {
    system: CONCEPTS_SYSTEM,
    user: conceptsUser({ title: paper.data.title, abstract: paper.data.abstract, topics: promptTopics, text: state.text }),
    maxTokens: 8000,
    hint: 'concepts',
  })

  const parsed = parseConcepts(json)
  if (parsed.length < 2) throw new Error('The model did not return a usable concept list.')

  const graph = cleanGraph(parsed.map((c) => ({ id: c.id, dependsOn: c.dependsOn })))
  const { branches, branchOf } = cleanBranches(
    json.branches,
    parsed.filter((c) => graph.ids.includes(c.id)).map((c) => ({ id: c.id, branchKey: c.branchKey })),
  )
  const paperNorm = normalizeForMatch(state.text)

  // Resolve each concept to a topic key, creating new topics as needed.
  const newTopics = new Map<string, TopicData>()
  const topicFor: Record<string, string> = {}
  for (const c of parsed) {
    if (!graph.ids.includes(c.id) || topicFor[c.id]) continue
    let key = normalizeTopicKey(asString(c.topic.key, 120) || c.name)
    if (!key) key = normalizeTopicKey(c.name) || `topic-${c.id}`
    topicFor[c.id] = key
    if (byKey.has(key) || newTopics.has(key)) continue
    const name = asString(c.topic.name, 120) || c.name
    newTopics.set(key, {
      key,
      name,
      level: normalizeLevel(c.topic.level) as TopicLevel,
      description: asString(c.topic.description, 400) || c.whyNeeded,
      searchQuery: asString(c.topic.search_query, 200) || `${name} explained for beginners`,
      resources: [],
      resourcesStatus: 'none',
      origin: 'paper',
    })
  }

  // Replace any concepts left by an earlier attempt for this paper.
  const old = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<unknown>[]
  for (const o of old) state.writes.push({ op: 'delete', collection: 'concepts', recordId: o.recordId })
  for (const t of newTopics.values()) {
    state.writes.push({ op: 'create', collection: 'topics', ignoreDuplicate: true, data: { ...t } })
  }
  let order = 0
  for (const c of parsed) {
    if (!graph.ids.includes(c.id)) continue
    state.writes.push({
      op: 'create',
      collection: 'concepts',
      ignoreDuplicate: true,
      data: {
        paperId: paper.recordId,
        arxivId: paper.data.arxivId,
        key: c.id,
        topicKey: topicFor[c.id],
        name: c.name,
        whyNeeded: c.whyNeeded,
        section: c.section,
        quote: c.quote,
        quoteVerified: c.quote ? isQuoteVerified(c.quote, paperNorm) : false,
        dependsOn: graph.deps[c.id],
        tier: graph.tiers[c.id],
        depth: c.depth,
        order: order++,
        check: null,
        branchKey: branchOf[c.id],
        explanation: '',
        explanationAt: 0,
      },
    })
  }

  // Topics that still need learning resources (shared across papers).
  const needed = [...new Set(Object.values(topicFor))].filter((k) => byKey.get(k)?.data.resourcesStatus !== 'ready')
  state.topicQueue = needed
  state.topicTotal = needed.length
  state.topicInfo = {}
  for (const k of needed) {
    const t = byKey.get(k)?.data ?? newTopics.get(k)
    if (t) state.topicInfo[k] = { name: t.name, description: t.description, searchQuery: t.searchQuery || t.name }
  }

  state.step = 'resources'
  await updatePaper(ctx, paper.recordId, {
    stage: 'resources',
    progress: 0.4,
    mainContribution: asString(json.main_contribution, 800),
    conceptCount: graph.ids.length,
    branches,
    progressMessage: needed.length ? `Finding explainers for ${needed.length} topics` : 'Writing the walkthrough',
  })
}

function extractCandidates(v: unknown): Candidate[] {
  const results = v && typeof v === 'object' ? (v as { results?: unknown }).results : null
  if (!Array.isArray(results)) return []
  const out: Candidate[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const url = asString(o.url, 500)
    if (!/^https?:\/\//.test(url)) continue
    out.push({
      title: asString(o.title, 200) || url,
      url,
      snippet: asString(o.text ?? o.summary ?? o.highlights, 4000).replace(/\s+/g, ' ').slice(0, 280),
    })
  }
  return out.slice(0, 5)
}

async function stepResources(state: AnalyzeState, { ctx, client, paper }: StepCtx) {
  if (state.topicQueue.length === 0) {
    state.step = 'explain'
    await updatePaper(ctx, paper.recordId, { stage: 'explain', progress: 0.8, progressMessage: 'Writing the section walkthrough and check questions' })
    return
  }
  const batch = state.topicQueue.slice(0, TOPICS_PER_TICK)
  const items: { key: string; name: string; description: string; candidates: Candidate[] }[] = []
  for (const key of batch) {
    const info = state.topicInfo[key] ?? { name: key, description: '', searchQuery: key }
    let candidates: Candidate[] = []
    // Two failed searches in a row means the provider is down; stop paying for more.
    if (state.exaFailures < 2) {
      try {
        candidates = extractCandidates(await client.call('exa/search', { query: info.searchQuery, numResults: 5 }, 'search'))
        state.exaFailures = 0
      } catch (e) {
        state.exaFailures += 1
        console.warn(`[analyze] exa search failed for ${key}: ${errMsg(e)}`)
      }
    }
    items.push({ key, name: info.name, description: info.description, candidates })
  }

  const picks: Record<string, TopicResource[]> = {}
  const withResults = items.filter((i) => i.candidates.length > 0)
  if (withResults.length > 0) {
    const json = await callModelJson(client, {
      system: RESOURCES_SYSTEM,
      user: resourcesUser(withResults),
      maxTokens: 3000,
      hint: 'resources',
    })
    const topics = Array.isArray(json.topics) ? json.topics : []
    for (const t of topics) {
      if (!t || typeof t !== 'object') continue
      const key = asString((t as Record<string, unknown>).key, 120)
      const item = withResults.find((i) => i.key === key)
      if (!item) continue
      const resources = Array.isArray((t as Record<string, unknown>).resources) ? ((t as Record<string, unknown>).resources as unknown[]) : []
      picks[key] = []
      for (const r of resources.slice(0, 2)) {
        if (!r || typeof r !== 'object') continue
        const url = asString((r as Record<string, unknown>).url, 500)
        const cand = item.candidates.find((c) => c.url === url)
        if (!cand) continue // never store a URL the search did not return
        picks[key].push({ title: cand.title, url: cand.url, why: asString((r as Record<string, unknown>).why, 300) })
      }
    }
  }

  for (const it of items) {
    const rows = (await ctx.records.query('topics', { where: { key: it.key }, limit: 1 })) as Envelope<TopicData>[]
    const row = rows[0]
    if (!row) continue
    const resources = picks[it.key] ?? []
    state.writes.push({
      op: 'update',
      collection: 'topics',
      recordId: row.recordId,
      data: { resources, resourcesStatus: resources.length > 0 ? 'ready' : 'failed' },
    })
  }

  state.topicQueue = state.topicQueue.slice(batch.length)
  const done = state.topicTotal - state.topicQueue.length
  await updatePaper(ctx, paper.recordId, {
    progress: 0.4 + 0.4 * (state.topicTotal ? done / state.topicTotal : 1),
    progressMessage: `Found explainers for ${done} of ${state.topicTotal} topics`,
  })
}

async function stepExplain(state: AnalyzeState, { ctx, client, paper }: StepCtx) {
  const concepts = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<{
    key: string
    name: string
    whyNeeded: string
    order: number
  }>[]
  concepts.sort((a, b) => a.data.order - b.data.order)
  const keys = new Set(concepts.map((c) => c.data.key))

  const json = await callModelJson(client, {
    system: EXPLAIN_SYSTEM,
    user: explainUser({
      title: paper.data.title,
      concepts: concepts.map((c) => ({ key: c.data.key, name: c.data.name, whyNeeded: c.data.whyNeeded })),
      text: state.text,
    }),
    maxTokens: 8000,
    hint: 'explain',
  })

  const old = (await ctx.records.query('sections', { where: { paperId: paper.recordId }, limit: 100 })) as Envelope<unknown>[]
  for (const o of old) state.writes.push({ op: 'delete', collection: 'sections', recordId: o.recordId })

  const sections = Array.isArray(json.sections) ? json.sections.slice(0, 14) : []
  sections.forEach((sec, i) => {
    if (!sec || typeof sec !== 'object') return
    const o = sec as Record<string, unknown>
    const heading = asString(o.heading, 200)
    if (!heading) return
    state.writes.push({
      op: 'create',
      collection: 'sections',
      ignoreDuplicate: true,
      data: {
        paperId: paper.recordId,
        arxivId: paper.data.arxivId,
        order: i,
        heading,
        summary: asString(o.summary, 2000),
        conceptKeys: asStringArray(o.concept_ids, 30).filter((k) => keys.has(k)),
      },
    })
  })

  const checks = Array.isArray(json.checks) ? json.checks : []
  for (const ch of checks) {
    if (!ch || typeof ch !== 'object') continue
    const o = ch as Record<string, unknown>
    const concept = concepts.find((c) => c.data.key === asString(o.concept_id, 20))
    const choices = asStringArray(o.choices, 6).map((c) => c.slice(0, 300))
    const answerIndex = typeof o.answer_index === 'number' ? Math.round(o.answer_index) : -1
    if (!concept || choices.length < 2 || answerIndex < 0 || answerIndex >= choices.length) continue
    state.writes.push({
      op: 'update',
      collection: 'concepts',
      recordId: concept.recordId,
      data: {
        check: {
          question: asString(o.question, 500),
          choices,
          answerIndex,
          explanation: asString(o.explanation, 500),
        },
      },
    })
  }

  state.step = 'finish'
  state.text = '' // no longer needed; keep the checkpoint small
  await updatePaper(ctx, paper.recordId, { progress: 0.95, progressMessage: 'Saving' })
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

async function loadPaper(ctx: CronContext, arxivId: string): Promise<Envelope<PaperData> | null> {
  const rows = (await ctx.records.query('papers', { where: { arxivId }, limit: 1 })) as Envelope<PaperData>[]
  return rows[0] ?? null
}

async function updatePaper(ctx: CronContext, recordId: string, data: Partial<PaperData>) {
  await ctx.records.update('papers', recordId, data as Record<string, unknown>)
}

async function flushWrites(ctx: CronContext, state: AnalyzeState) {
  const batch = state.writes.slice(0, WRITES_PER_TICK)
  for (const w of batch) {
    try {
      if (w.op === 'create' && w.data) await ctx.records.create(w.collection, w.data)
      else if (w.op === 'update' && w.recordId && w.data) await ctx.records.update(w.collection, w.recordId, w.data)
      else if (w.op === 'delete' && w.recordId) await ctx.records.delete(w.collection, w.recordId)
    } catch (e) {
      const m = errMsg(e)
      const benign = (w.ignoreDuplicate && /duplicate/i.test(m)) || (w.op === 'delete' && /not found/i.test(m))
      if (!benign) throw e
    }
    state.writes.shift()
  }
}
