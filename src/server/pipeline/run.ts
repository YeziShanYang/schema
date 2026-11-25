/**
 * The `analyze` background job: one paper from arXiv PDF to a finished
 * roadmap. It runs as a sequence of short ticks, each saved with
 * `ctx.continue`, so no single run comes near the Worker subrequest limit and
 * a restart resumes from the last checkpoint instead of starting over.
 *
 * Steps: seed -> text -> concepts -> overview -> explain -> verify -> remap -> finish.
 * - seed: starter topics, and clearing the concepts and sections of an earlier analysis.
 * - text: the arXiv HTML with its math as LaTeX, or the PDF through CloudConvert.
 * - concepts: one model call; the server applies the graph, branch, topic and quote rules,
 *   and finds a quote in the text for a concept whose candidates all failed them.
 * - overview: one model call (plain summary, story, plain roles).
 * - explain: one model call for the section walkthrough.
 * - verify: one model call checks the overview against the paper and drops what
 *   it does not support; a collapsed story sends the job back to overview once.
 * - remap: readers' checkmarks from an earlier analysis move to the new concepts.
 * Explainer links are not fetched here; readers load them per branch on
 * demand (src/server/branch-resources.ts). Record writes produced by a step are queued in the
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
import type { ConceptDepth, ConceptKnowledgeData, Envelope, PaperData, TextSource, TimedStage, TopicData } from '../../types'
import { PIPELINE_VERSION } from '../../types'
import { arxivPdfUrl, arxivSlug } from '../../lib/arxiv'
import { preparePaperText } from '../../lib/paper-text'
import { arxivHtmlToText, arxivHtmlUrl, MIN_HTML_TEXT_CHARS } from '../../lib/paper-html'
import { indexPaperText } from '../../lib/quotes'
import { pickQuote, quotePickOrder } from '../../lib/quote-rules'
import { findNamedQuote, nameTerms, quoteSearch } from '../../lib/quote-fallback'
import { hasMath } from '../../lib/math'
import { cleanGraph } from '../../lib/graph'
import { foundationDepth } from '../../lib/depth'
import { asString, asStringArray } from '../../lib/json'
import { STARTER_TOPICS } from '../../lib/topics'
import { planKnowledgeRemap } from '../../lib/knowledge-remap'
import { closeTimings, enterStage } from '../../lib/timings'
import { assignTopics, promptTopics } from './assign-topics'
import { generateOverview, type OverviewConcept } from '../overview'
import { cleanBranches } from '../../lib/branches'
import { mergeSingletonBranches } from '../../lib/branch-merge'
import { fixBranchPlacement } from '../../lib/branch-placement'
import { createPipelineClient, fixturesAllowed, ownerContext } from './client'
import { refundAnalyze } from '../usage'
import type { PipelineClient } from './client'
import { callModelJson } from './llm'
import { conceptsSystem, conceptsUser, explainSystem, explainUser, verifySystem, verifyUser } from './prompts'
import { applyVerdict, parseVerdict, unglossedNames, VERIFY_TEXT_CHARS } from './verify'

export interface AnalyzePayload {
  paperId: string
  arxivId: string
}

type Step = 'seed' | 'text' | 'concepts' | 'overview' | 'explain' | 'verify' | 'remap' | 'finish'

interface PendingWrite {
  op: 'create' | 'update' | 'delete'
  collection: string
  recordId?: string
  data?: Record<string, unknown>
  /** Treat a uniqueOn refusal as success (idempotent creates). */
  ignoreDuplicate?: boolean
}

export interface AnalyzeState {
  step: Step
  text: string
  writes: PendingWrite[]
  failures: number
  /** True once any integration call has succeeded (and was billed); then a failure keeps the daily slot. */
  spent?: boolean
  /** Where `text` came from; checkpoints saved before the HTML source existed used the PDF. */
  textSource?: TextSource
  /** How many times the overview has been written: a second write is the one rewrite verify may ask for. */
  overviewPasses?: number
  /** What verify found wrong with the first overview, given to the rewrite. */
  overviewFeedback?: string[]
}

const WRITES_PER_TICK = 20
const MAX_CONCEPTS = 24
/** Most walkthrough entries kept. The prompt asks for one per top-level section, which real papers keep well under this. */
export const MAX_SECTIONS = 20
/** Non-whitespace characters below which a PDF is treated as scanned or empty; real papers have tens of thousands. */
const MIN_TEXT_CHARS = 600

class PermanentError extends Error {}

function initialState(): AnalyzeState {
  return { step: 'seed', text: '', writes: [], failures: 0 }
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
    // The slot goes back before the paper shows failed, so a reader whose allowance refreshes on that change sees it.
    if (!state.spent) await refundAnalyze(ctx.records, paper.recordId)
    await updatePaper(ctx, paper.recordId, {
      status: 'failed',
      stage: 'failed',
      error: 'Analysis was canceled.',
      timings: closeTimings(paper.data.timings, Date.now()),
    })
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
      const base = createPipelineClient(env, fixturesAllowed(env, payload.arxivId), ctx, payload.arxivId)
      // Every successful integration call is billed, so from then on a failure keeps the slot.
      const client: PipelineClient = {
        ...base,
        call: async (endpoint, body, hint) => {
          const out = await base.call(endpoint, body, hint)
          next.spent = true
          return out
        },
      }
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
    state.spent = state.spent || next.spent
    if (!(e instanceof PermanentError) && state.failures < 2) {
      await updatePaper(ctx, paper.recordId, { progressMessage: `Retrying after an error: ${message}`, retries: (paper.data.retries ?? 0) + 1 })
      jobCtx.continue(state, { afterMs: 3000 })
      return
    }
    // The requester's daily slot is given back only if nothing was paid for yet. It goes back before the paper
    // shows failed, so a reader whose allowance refreshes on that change sees it.
    try {
      if (!state.spent) await refundAnalyze(ctx.records, paper.recordId)
    } catch (refundError) {
      console.error(`[analyze] refund failed for ${payload.arxivId}: ${errMsg(refundError)}`)
    }
    // `paper.data.timings` is kept current by enterPaperStage, so a stage entered in this tick is closed too.
    await updatePaper(ctx, paper.recordId, {
      status: 'failed',
      stage: 'failed',
      error: message,
      progressMessage: '',
      timings: closeTimings(paper.data.timings, Date.now()),
    })
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
  // Checkpoints saved before links became lazy may still name the old step.
  if ((state.step as string) === 'resources') state.step = 'explain'
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
    case 'overview':
      await stepOverview(state, s)
      return false
    case 'explain':
      await stepExplain(state, s)
      return false
    case 'verify':
      await stepVerify(state, s)
      return false
    case 'remap':
      await stepRemap(state, s)
      return false
    case 'finish': {
      // Counts come from the concepts actually stored, so every page agrees,
      // and a concept that failed to land is logged instead of hidden.
      const stored = (await s.ctx.records.query('concepts', { where: { paperId: s.paper.recordId }, limit: 200 })) as Envelope<{
        key: string
        topicKey: string
        quote?: string
        quoteVerified?: boolean
      }>[]
      if (s.paper.data.conceptCount && stored.length !== s.paper.data.conceptCount) {
        console.warn(`[analyze] ${s.paper.data.arxivId}: ${stored.length} of ${s.paper.data.conceptCount} concepts stored`)
      }
      await updatePaper(s.ctx, s.paper.recordId, {
        status: 'ready',
        stage: 'ready',
        timings: closeTimings(s.paper.data.timings, Date.now()),
        progress: 1,
        progressMessage: '',
        error: '',
        conceptCount: stored.length,
        conceptsWithoutQuote: stored.filter((c) => !c.data.quote || !c.data.quoteVerified).length,
        topicKeys: [...new Set(stored.map((c) => c.data.topicKey).filter(Boolean))],
        pipelineVersion: PIPELINE_VERSION,
      })
      return true
    }
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepSeed(state: AnalyzeState, s: StepCtx) {
  const { ctx, paper } = s
  await enterPaperStage(s, 'text', { status: 'processing', progress: 0.05, progressMessage: 'Preparing', error: '' })
  const existing = (await ctx.records.query('topics', { where: { origin: 'starter' }, limit: 200 })) as Envelope<TopicData>[]
  const have = new Set(existing.map((t) => t.data.key))
  for (const t of STARTER_TOPICS) {
    if (have.has(t.key)) continue
    state.writes.push({
      op: 'create',
      collection: 'topics',
      ignoreDuplicate: true,
      data: { ...t, searchQuery: `${t.name} tutorial for beginners`, resources: [], resourcesStatus: 'none', resourcesLoadingAt: 0, origin: 'starter' },
    })
  }
  // A re-analysis (or a retry) starts clean. Readers' checkmarks are kept and moved in the remap step.
  for (const collection of ['concepts', 'sections'] as const) {
    const old = (await ctx.records.query(collection, { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<unknown>[]
    for (const o of old) state.writes.push({ op: 'delete', collection, recordId: o.recordId })
  }
  state.step = 'text'
}

/** The arXiv HTML as text, or '' when it is missing, too short or unreachable (the PDF is used then). */
async function htmlText(client: PipelineClient, arxivId: string, signal: AbortSignal): Promise<string> {
  try {
    const page = await client.fetchPage(arxivHtmlUrl(arxivId), signal)
    if (page.status !== 200) {
      console.info(`[analyze] ${arxivId}: no arXiv HTML (status ${page.status}), using the PDF`)
      return ''
    }
    const text = arxivHtmlToText(page.text)
    if (text.length < MIN_HTML_TEXT_CHARS) {
      console.info(`[analyze] ${arxivId}: arXiv HTML has only ${text.length} characters of text, using the PDF`)
      return ''
    }
    return text
  } catch (e) {
    console.warn(`[analyze] ${arxivId}: arXiv HTML fetch failed, using the PDF: ${errMsg(e)}`)
    return ''
  }
}

async function stepText(state: AnalyzeState, s: StepCtx) {
  const { env, ctx, client, paper, jobCtx } = s
  await enterPaperStage(s, 'text', { progress: 0.1, progressMessage: 'Reading the paper' })
  const files = appFiles(env, { scope: 'app', userId: env.OWNER_USER_ID })
  const arxivId = paper.data.arxivId

  // 1. The arXiv HTML (free, math as LaTeX). 2. Text stored by an earlier run. 3. The PDF through CloudConvert.
  let source: TextSource = 'html'
  let raw = await htmlText(client, arxivId, jobCtx.signal)
  let fresh = true
  if (!raw && paper.data.textKey && !client.fixtures) {
    try {
      const res = await files.download(paper.data.textKey)
      raw = await res.text()
      source = paper.data.textSource ?? 'pdf'
      fresh = false
    } catch {
      raw = ''
    }
  }
  if (!raw) {
    source = 'pdf'
    await updatePaper(ctx, paper.recordId, { progressMessage: 'Converting the PDF to text' })
    const conv = (await client.call(
      'cloudconvert/convert-file',
      { input_format: 'pdf', output_format: 'txt', url: arxivPdfUrl(arxivId) },
      'text',
    )) as { downloadUrl?: string; url?: string } | null
    const url = conv?.downloadUrl ?? conv?.url
    if (!url) throw new Error('The PDF converter did not return a file.')
    raw = await client.fetchText(url, jobCtx.signal)
  }

  const prepared = preparePaperText(raw, undefined, source)
  if (prepared.text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
    throw new PermanentError('This PDF has almost no extractable text (it may be a scanned image).')
  }

  let textKey = fresh ? '' : paper.data.textKey
  if (!client.fixtures && fresh) {
    try {
      // The key names the source, so text from the PDF and from the HTML never overwrite each other.
      const file = await files.upload(new Blob([prepared.text], { type: 'text/plain' }), {
        key: `papers/${arxivSlug(arxivId)}.${source}.txt`,
        name: `${arxivSlug(arxivId)}.${source}.txt`,
      })
      textKey = file.key
    } catch (e) {
      // Storage is a cache for retries and explanations; the pipeline continues without it.
      console.warn(`[analyze] could not store text for ${arxivId}: ${errMsg(e)}`)
      textKey = paper.data.textKey || ''
    }
  }

  state.text = prepared.text
  state.textSource = source
  state.step = 'concepts'
  await enterPaperStage(s, 'concepts', {
    progress: 0.2,
    textChars: prepared.text.length,
    textKey,
    textSource: source,
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
  /** Candidate quotes, best first; the server keeps the first that passes the quote rules. */
  quotes: string[]
  dependsOn: string[]
  depth: ConceptDepth
  branchKey: string
  topic: Record<string, unknown>
}

export function parseConcepts(json: Record<string, unknown>): ParsedConcept[] {
  const list = Array.isArray(json.concepts) ? json.concepts : []
  const out: ParsedConcept[] = []
  for (const item of list.slice(0, MAX_CONCEPTS)) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const name = asString(c.name, 200)
    const id = asString(c.id, 20)
    if (!name || !id) continue
    const depth = c.depth === 'skim' || c.depth === 'deep' ? c.depth : 'working'
    // `quote` is the single-quote format of earlier prompts.
    const quotes = (Array.isArray(c.quotes) ? asStringArray(c.quotes, 2) : [asString(c.quote, 600)]).map((q) => q.slice(0, 600)).filter(Boolean)
    out.push({
      id,
      name,
      whyNeeded: asString(c.why_needed, 600),
      section: asString(c.section, 200),
      quotes,
      dependsOn: asStringArray(c.depends_on, 20),
      depth,
      branchKey: asString(c.branch_key, 80),
      topic: c.topic && typeof c.topic === 'object' ? (c.topic as Record<string, unknown>) : {},
    })
  }
  return out
}

async function stepConcepts(state: AnalyzeState, s: StepCtx) {
  const { ctx, client, paper } = s
  const source = state.textSource ?? 'pdf'
  const topics = (await ctx.records.query('topics', { limit: 1000 })) as Envelope<TopicData>[]

  const json = await callModelJson(client, {
    system: conceptsSystem(source, state.text.length),
    user: conceptsUser({ title: paper.data.title, abstract: paper.data.abstract, topics: promptTopics(topics.map((t) => t.data)), text: state.text }),
    maxTokens: 20000, // thinking counts against this; 8000 ran out in production
    hint: 'concepts',
  })

  const parsed = parseConcepts(json)
  if (parsed.length < 2) throw new Error('The model did not return a usable concept list.')

  const graph = cleanGraph(parsed.map((c) => ({ id: c.id, dependsOn: c.dependsOn })))
  const kept = parsed.filter((c) => graph.ids.includes(c.id))
  const cleaned = cleanBranches(json.branches, kept.map((c) => ({ id: c.id, branchKey: c.branchKey })))
  const merged = mergeSingletonBranches(cleaned.branches, cleaned.branchOf, graph.deps)
  const branches = merged.branches
  for (const m of merged.merges) console.info(`[analyze] ${paper.data.arxivId}: single-concept branch ${m.from} merged into ${m.to}`)
  // Concepts filed so that the branches depend on each other in a circle move to a branch that breaks it.
  const placement = fixBranchPlacement(branches, merged.branchOf, graph.deps, graph.tiers)
  const branchOf = placement.branchOf
  for (const m of placement.moves) console.info(`[analyze] ${paper.data.arxivId}: ${m.conceptId} moved from branch ${m.from} to ${m.to} (${m.rule})`)
  if (placement.cycleBefore) {
    console.info(`[analyze] ${paper.data.arxivId}: branch cycle ${placement.cycleAfter ? 'remains' : 'resolved'} after ${placement.moves.length} moves`)
  }

  // Resolve each concept to its own topic key, creating new topics as needed.
  const topicByKey = new Map(topics.map((t) => [t.data.key, t]))
  const { topicFor, newTopics, rejected } = assignTopics(kept, new Map(topics.map((t) => [t.data.key, t.data])))
  for (const r of rejected) console.info(`[analyze] ${paper.data.arxivId}: ${r.id} does not reuse ${r.from}, gets ${r.to}`)

  for (const t of newTopics.values()) {
    state.writes.push({ op: 'create', collection: 'topics', ignoreDuplicate: true, data: { ...t } })
  }
  // A paper-only topic whose links were skipped is shared now, so it gets links on the next branch load.
  for (const key of new Set(Object.values(topicFor))) {
    const t = topicByKey.get(key)
    if (t?.data.resourcesStatus === 'skipped') {
      state.writes.push({ op: 'update', collection: 'topics', recordId: t.recordId, data: { resourcesStatus: 'none' } })
    }
  }

  // A foundation with no prerequisites is at most "working". This runs before the quotes, which deep concepts pick first.
  const levelOf = (id: string) => topicByKey.get(topicFor[id])?.data.level ?? newTopics.get(topicFor[id])?.level
  for (const c of kept) {
    const depth = foundationDepth(c.depth, graph.deps[c.id], levelOf(c.id))
    if (depth === c.depth) continue
    console.info(`[analyze] ${paper.data.arxivId}: ${c.id} is a foundation with no prerequisites, depth ${c.depth} -> ${depth}`)
    c.depth = depth
  }

  // Deep concepts pick first, so a central idea keeps a passage it shares with a foundation.
  const paperIndex = indexPaperText(state.text)
  const usedQuotes = new Set<string>()
  const quoteOf: Record<string, string> = {}
  const pickOrder = quotePickOrder(kept)
  for (const c of pickOrder) {
    const { quote, rejected: badQuotes, extendedFrom, wholeSentenceFrom } = pickQuote(c.quotes, paperIndex, usedQuotes)
    if (badQuotes.length) console.info(`[analyze] ${paper.data.arxivId}: ${c.id} quotes rejected: ${badQuotes.map((b) => b.problem).join(', ')}`)
    if (extendedFrom) console.info(`[analyze] ${paper.data.arxivId}: ${c.id} quote carried on to the end of its sentence`)
    if (wholeSentenceFrom) console.info(`[analyze] ${paper.data.arxivId}: ${c.id} quote carried back to the start of its sentence`)
    quoteOf[c.id] = quote
  }
  // A concept whose candidates all failed gets the first sentence that names it and passes the same rules.
  // This runs after every concept has had its candidates, so it never takes a passage a candidate chose.
  const missing = pickOrder.filter((c) => !quoteOf[c.id])
  if (missing.length) {
    const search = quoteSearch(paperIndex)
    const topicName = (id: string) => topicByKey.get(topicFor[id])?.data.name ?? newTopics.get(topicFor[id])?.name ?? ''
    for (const c of missing) {
      const others = kept.filter((o) => o.id !== c.id).flatMap((o) => [o.name, topicName(o.id)])
      const found = findNamedQuote(nameTerms(c.name, topicName(c.id), others, state.text), search, usedQuotes)
      if (!found) continue
      quoteOf[c.id] = found.quote
      console.info(`[analyze] ${paper.data.arxivId}: ${c.id} quote found in the text by its ${found.kind} "${found.term}"`)
    }
  }
  const unquoted = kept.filter((c) => !quoteOf[c.id]).map((c) => c.id)
  if (unquoted.length) console.info(`[analyze] ${paper.data.arxivId}: ${unquoted.length} of ${kept.length} concepts have no quote: ${unquoted.join(', ')}`)
  let order = 0
  for (const c of kept) {
    const quote = quoteOf[c.id]
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
        quote,
        quoteVerified: !!quote,
        // HTML text already has its math as LaTeX, so the quote displays as is. PDF math can't be trusted to rewrite.
        quoteDisplay: source === 'html' && quote && hasMath(quote) ? quote : '',
        dependsOn: graph.deps[c.id],
        tier: graph.tiers[c.id],
        depth: c.depth,
        order: order++,
        branchKey: branchOf[c.id],
        explanation: '',
        explanationAt: 0,
      },
    })
  }

  state.step = 'overview'
  await enterPaperStage(s, 'overview', {
    progress: 0.55,
    mainContribution: asString(json.main_contribution, 800),
    conceptCount: graph.ids.length,
    branches,
    topicKeys: [...new Set(Object.values(topicFor))],
    overview: null,
    progressMessage: 'Writing a plain-language overview',
  })
}

/**
 * One call for the plain-language overview and each concept's plain role.
 * It is not essential to the analysis: if it fails, the paper goes on
 * without one and ensureOverview generates it when a reader opens the paper.
 * The second time it runs is the rewrite verify asked for, with its feedback.
 */
async function stepOverview(state: AnalyzeState, s: StepCtx) {
  const { ctx, client, paper } = s
  const concepts = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<
    OverviewConcept & { quoteVerified?: boolean }
  >[]
  const rewrite = (state.overviewPasses ?? 0) >= 1
  state.overviewPasses = (state.overviewPasses ?? 0) + 1
  try {
    const input = concepts.map((c) => ({ ...c.data, quote: c.data.quoteVerified ? c.data.quote : '' }))
    const { overview, roles } = await generateOverview(client, paper.data, state.text, input, {
      source: state.textSource ?? 'pdf',
      feedback: rewrite ? state.overviewFeedback : undefined,
    })
    for (const c of concepts) {
      if (roles[c.data.key]) state.writes.push({ op: 'update', collection: 'concepts', recordId: c.recordId, data: { plainRole: roles[c.data.key] } })
    }
    await updatePaper(ctx, paper.recordId, { overview })
  } catch (e) {
    console.warn(`[analyze] ${paper.data.arxivId}: overview ${rewrite ? 'rewrite ' : ''}skipped: ${errMsg(e)}`)
  }
  state.step = rewrite ? 'verify' : 'explain'
  await enterPaperStage(s, rewrite ? 'verify' : 'explain', {
    progress: rewrite ? 0.85 : 0.7,
    progressMessage: rewrite ? 'Checking the rewritten overview against the paper' : 'Writing the section walkthrough',
  })
}

/** The walkthrough entries kept from the explain call (at most MAX_SECTIONS), and how many it returned. */
function walkthroughSections(json: Record<string, unknown>): { sections: unknown[]; returned: number } {
  const list = Array.isArray(json.sections) ? json.sections : []
  return { sections: list.slice(0, MAX_SECTIONS), returned: list.length }
}

async function stepExplain(state: AnalyzeState, s: StepCtx) {
  const { ctx, client, paper } = s
  const concepts = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<{
    key: string
    name: string
    whyNeeded: string
    order: number
  }>[]
  concepts.sort((a, b) => a.data.order - b.data.order)
  const keys = new Set(concepts.map((c) => c.data.key))

  const json = await callModelJson(client, {
    system: explainSystem(state.textSource ?? 'pdf'),
    user: explainUser({
      title: paper.data.title,
      concepts: concepts.map((c) => ({ key: c.data.key, name: c.data.name, whyNeeded: c.data.whyNeeded })),
      text: state.text,
    }),
    maxTokens: 12000,
    hint: 'explain',
  })

  const old = (await ctx.records.query('sections', { where: { paperId: paper.recordId }, limit: 100 })) as Envelope<unknown>[]
  for (const o of old) state.writes.push({ op: 'delete', collection: 'sections', recordId: o.recordId })

  const { sections, returned } = walkthroughSections(json)
  if (returned > sections.length) console.info(`[analyze] ${paper.data.arxivId}: walkthrough cut from ${returned} to ${sections.length} sections`)
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

  state.step = 'verify'
  await enterPaperStage(s, 'verify', { progress: 0.85, progressMessage: 'Checking the overview against the paper' })
}

/**
 * Checks the overview against the paper and keeps what it supports (see
 * pipeline/verify.ts). A first failure is retried like any step; a second one
 * keeps the overview unchecked rather than failing the whole paper.
 */
async function stepVerify(state: AnalyzeState, s: StepCtx) {
  const { ctx, client, paper } = s
  const overview = paper.data.overview
  const done = () => {
    state.text = '' // no longer needed; keep the checkpoint small
    state.overviewFeedback = undefined
    state.step = 'remap'
  }
  if (!overview) return done()

  const concepts = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<{
    key: string
    name: string
    whyNeeded: string
    order: number
    quote: string
    quoteVerified: boolean
    plainRole?: string
  }>[]
  concepts.sort((a, b) => a.data.order - b.data.order)
  const source = state.textSource ?? 'pdf'

  let json: Record<string, unknown>
  try {
    json = await callModelJson(client, {
      system: verifySystem(source),
      user: verifyUser({
        title: paper.data.title,
        abstract: paper.data.abstract,
        text: state.text.slice(0, VERIFY_TEXT_CHARS),
        concepts: concepts.map((c) => ({ key: c.data.key, name: c.data.name, whyNeeded: c.data.whyNeeded, quote: c.data.quoteVerified ? c.data.quote : '' })),
        plain: overview.plain,
        story: overview.story.map((s) => ({ id: s.id, text: s.text, technical: s.technical })),
        roles: concepts.filter((c) => c.data.plainRole).map((c) => ({ key: c.data.key, role: c.data.plainRole! })),
      }),
      maxTokens: 8000,
      hint: 'verify',
    })
  } catch (e) {
    if (state.failures < 1) throw e
    console.warn(`[analyze] ${paper.data.arxivId}: overview check skipped after a retry: ${errMsg(e)}`)
    return done()
  }

  const final = (state.overviewPasses ?? 1) >= 2
  const outcome = applyVerdict(overview, parseVerdict(json), concepts.map((c) => c.data.key), { final })
  for (const p of outcome.problems) console.info(`[analyze] ${paper.data.arxivId}: overview check: ${p}`)
  if (outcome.regenerate) {
    state.overviewFeedback = outcome.problems
    state.step = 'overview'
    await enterPaperStage(s, 'overview', { progress: 0.8, progressMessage: 'Rewriting the overview' })
    return
  }

  const names = concepts.map((c) => c.data.name)
  for (const s of outcome.overview!.story) {
    const terms = unglossedNames(s.text, names)
    if (terms.length) console.info(`[analyze] ${paper.data.arxivId}: story ${s.id} names ${terms.join(', ')} without explaining it`)
  }
  for (const key of outcome.droppedRoles) {
    const c = concepts.find((k) => k.data.key === key)
    if (c?.data.plainRole) state.writes.push({ op: 'update', collection: 'concepts', recordId: c.recordId, data: { plainRole: '' } })
  }
  await updatePaper(ctx, paper.recordId, {
    overview: outcome.overview,
    overviewDropped: { story: outcome.droppedStory, technical: outcome.droppedTechnical, regenerated: final },
  })
  done()
}

/**
 * Moves readers' checkmarks from an earlier analysis of this paper to the new
 * concepts with the same normalized name; a row with no match is kept and
 * marked stale (see lib/knowledge-remap.ts).
 */
async function stepRemap(state: AnalyzeState, { ctx, paper }: StepCtx) {
  const rows = (await ctx.records.query('concept_knowledge', { where: { paperId: paper.recordId }, limit: 1000 })) as Envelope<ConceptKnowledgeData>[]
  if (rows.length) {
    const concepts = (await ctx.records.query('concepts', { where: { paperId: paper.recordId }, limit: 200 })) as Envelope<{
      name: string
      topicKey: string
    }>[]
    const plan = planKnowledgeRemap(
      rows.map((r) => ({ recordId: r.recordId, ...r.data })),
      concepts.map((c) => ({ conceptId: c.recordId, name: c.data.name, topicKey: c.data.topicKey })),
    )
    for (const m of plan.moves) state.writes.push({ op: 'update', collection: 'concept_knowledge', recordId: m.recordId, data: m.data })
    for (const id of plan.deletes) state.writes.push({ op: 'delete', collection: 'concept_knowledge', recordId: id })
    console.info(`[analyze] ${paper.data.arxivId}: checkmarks ${plan.moves.length} updated, ${plan.deletes.length} duplicates removed`)
  }
  state.step = 'finish'
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

/**
 * Moves the paper to `stage` and records the change in its timings. The
 * tick's copy of the paper is updated first, so a failure later in the same
 * tick closes the stage that was just entered.
 */
async function enterPaperStage(s: StepCtx, stage: TimedStage, data: Partial<PaperData>) {
  s.paper.data.timings = enterStage(s.paper.data.timings, stage, Date.now())
  await updatePaper(s.ctx, s.paper.recordId, { ...data, stage, timings: s.paper.data.timings })
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
      if (w.op === 'create') console.info(`[analyze] skipped existing ${w.collection} row: ${m.slice(0, 160)}`)
    }
    state.writes.shift()
  }
}
