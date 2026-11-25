/**
 * Explainer links, loaded per branch on demand. For each of the branch's
 * topics with no resources yet: one Exa search, then one Haiku call per batch
 * of five topics picks one or two results. Links are stored on the topic, so
 * every later paper that needs the topic gets them free.
 *
 * Topics are marked `loading` (with a timestamp) before any paid call so two
 * readers opening the same branch do not pay twice. A `loading` mark older
 * than five minutes is treated as stale, so a crashed load can be retried.
 *
 * A specialized topic that only this paper uses gets no search (status
 * `skipped`): general explainers rarely exist for it, and its cards lead with
 * Explain with AI instead. When the pick call finds no fitting result, the
 * topic keeps an empty list; raw search results are used only when the pick
 * call itself fails, and only those whose title shares at least two content
 * words with the topic's name (fallbackTitleFits).
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ConceptData, Envelope, PaperData, TopicData, TopicResource } from '../types'
import { asString } from '../lib/json'
import { fallbackTitleFits, linkTitle } from '../lib/links'
import { createPipelineClient, fixturesAllowed } from './pipeline/client'
import type { PipelineClient } from './pipeline/client'
import { callModelJson } from './pipeline/llm'
import { RESOURCES_SYSTEM, resourcesUser, type Candidate } from './pipeline/prompts'

export const LOADING_STALE_MS = 5 * 60 * 1000
/** Topics handled per call; a bigger branch finishes on the next call. */
export const MAX_TOPICS_PER_LOAD = 8
const PICK_BATCH = 5

/** True when this topic should be fetched now: no links yet, or a stale loading mark. */
export function needsLoad(t: Pick<TopicData, 'resourcesStatus' | 'resourcesLoadingAt'>, now: number): boolean {
  if (t.resourcesStatus === 'none' || !t.resourcesStatus) return true
  if (t.resourcesStatus === 'loading') return now - (t.resourcesLoadingAt || 0) > LOADING_STALE_MS
  return false
}

/** Up to five usable results from an Exa search response. */
export function extractCandidates(v: unknown): Candidate[] {
  const results = v && typeof v === 'object' ? (v as { results?: unknown }).results : null
  if (!Array.isArray(results)) return []
  const out: Candidate[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const url = asString(o.url, 500)
    if (!/^https?:\/\//.test(url)) continue
    out.push({
      title: linkTitle(asString(o.title, 200), url),
      url,
      snippet: asString(o.text ?? o.summary ?? o.highlights, 4000).replace(/\s+/g, ' ').slice(0, 280),
    })
  }
  return out.slice(0, 5)
}

interface TopicItem {
  key: string
  name: string
  description: string
  candidates: Candidate[]
}

/**
 * For when the pick call fails: the top search results whose title shares at
 * least two content words with the topic's name, as links without a "why" line.
 */
export function fallbackResources(topicName: string, candidates: Candidate[]): TopicResource[] {
  return candidates
    .filter((c) => fallbackTitleFits(topicName, c.title))
    .slice(0, 2)
    .map((c) => ({ title: c.title, url: c.url, why: '' }))
}

/** A specialized topic created by a paper and used by no other paper: no web search, Explain with AI instead. */
export function skipsLinks(t: Pick<TopicData, 'level' | 'origin'>, papersUsingIt: number): boolean {
  return t.level === 'specialized' && t.origin === 'paper' && papersUsingIt <= 1
}

/**
 * Search and pick for a set of topics. Returns picked resources per topic key
 * and whether any paid call succeeded. A topic the pick call found nothing
 * for gets an empty list. If a pick call fails after its searches ran, those
 * topics keep their matching top search results instead (fallbackResources).
 */
export async function findResources(
  client: PipelineClient,
  topics: { key: string; name: string; description: string; searchQuery: string }[],
): Promise<{ picks: Record<string, TopicResource[]>; charged: boolean }> {
  // Searches run in parallel; results for a topic whose search failed are empty.
  const searched: TopicItem[] = await Promise.all(
    topics.map(async (t) => {
      try {
        const res = await client.call('exa/search', { query: t.searchQuery || t.name, numResults: 5 }, 'search')
        return { key: t.key, name: t.name, description: t.description, candidates: extractCandidates(res) }
      } catch (e) {
        console.warn(`[links] exa search failed for ${t.key}: ${e instanceof Error ? e.message : String(e)}`)
        return { key: t.key, name: t.name, description: t.description, candidates: [] }
      }
    }),
  )

  const picks: Record<string, TopicResource[]> = {}
  const withResults = searched.filter((i) => i.candidates.length > 0)
  for (let i = 0; i < withResults.length; i += PICK_BATCH) {
    const batch = withResults.slice(i, i + PICK_BATCH)
    let json: Record<string, unknown>
    try {
      json = await callModelJson(client, {
        system: RESOURCES_SYSTEM,
        user: resourcesUser(batch),
        maxTokens: 6000,
        hint: 'resources',
      })
    } catch (e) {
      console.warn(`[links] pick call failed, keeping top search results: ${e instanceof Error ? e.message : String(e)}`)
      for (const item of batch) picks[item.key] = fallbackResources(item.name, item.candidates)
      continue
    }
    const list = Array.isArray(json.topics) ? json.topics : []
    for (const t of list) {
      if (!t || typeof t !== 'object') continue
      const o = t as Record<string, unknown>
      const item = batch.find((b) => b.key === asString(o.key, 120))
      if (!item) continue
      const resources = Array.isArray(o.resources) ? (o.resources as unknown[]) : []
      picks[item.key] = []
      for (const r of resources.slice(0, 2)) {
        if (!r || typeof r !== 'object') continue
        const url = asString((r as Record<string, unknown>).url, 500)
        const cand = item.candidates.find((c) => c.url === url)
        if (!cand) continue // never store a URL the search did not return
        picks[item.key].push({ title: cand.title, url: cand.url, why: asString((r as Record<string, unknown>).why, 300) })
      }
    }
    // A topic the model skipped, or answered only with URLs the search did not return, found no fit.
    for (const item of batch) picks[item.key] ??= []
  }
  return { picks, charged: withResults.length > 0 }
}

export type BranchLoadOutcome =
  | { ok: true; loaded: number; failed: number; remaining: number; busy: number; charged: boolean }
  | { ok: false; error: string; charged?: boolean }

/**
 * Loads links for one branch of one paper. `charged` is true when paid calls
 * were made, so the caller can count it toward the daily cap.
 */
export async function loadBranch(
  env: Env,
  tools: ActionTools,
  paper: Envelope<PaperData>,
  branchKey: string,
): Promise<BranchLoadOutcome> {
  const conceptsRes = await tools.query('concepts', { where: { paperId: paper.recordId, branchKey }, limit: 100 })
  if (!conceptsRes.success) return { ok: false, error: conceptsRes.error }
  const concepts = conceptsRes.data.records as unknown as Envelope<ConceptData>[]
  if (concepts.length === 0) return { ok: false, error: 'This branch has no concepts.' }
  const keys = [...new Set(concepts.map((c) => c.data.topicKey).filter(Boolean))]

  const rows = await Promise.all(
    keys.map(async (key) => {
      const r = await tools.query('topics', { where: { key }, limit: 1 })
      return r.success ? ((r.data.records as unknown as Envelope<TopicData>[])[0] ?? null) : null
    }),
  )
  const now = Date.now()
  const topics = rows.filter((t): t is Envelope<TopicData> => !!t)
  const candidates = topics.filter((t) => needsLoad(t.data, now))

  // Paper-only specialized topics are marked skipped instead of searched.
  const due: Envelope<TopicData>[] = []
  for (const t of candidates) {
    if (t.data.level === 'specialized' && t.data.origin === 'paper') {
      const users = await tools.query('concepts', { where: { topicKey: t.data.key }, limit: 20 })
      const papers = users.success ? new Set((users.data.records as unknown as Envelope<ConceptData>[]).map((c) => c.data.paperId)).size : 2
      if (skipsLinks(t.data, papers)) {
        await tools.update('topics', t.recordId, { resourcesStatus: 'skipped', resourcesLoadingAt: 0 })
        continue
      }
    }
    due.push(t)
  }
  const busy = topics.filter((t) => t.data.resourcesStatus === 'loading' && !needsLoad(t.data, now)).length
  if (due.length === 0) return { ok: true, loaded: 0, failed: 0, remaining: 0, busy, charged: false }

  const batch = due.slice(0, MAX_TOPICS_PER_LOAD)
  for (const t of batch) {
    await tools.update('topics', t.recordId, { resourcesStatus: 'loading', resourcesLoadingAt: now })
  }

  let picks: Record<string, TopicResource[]>
  let charged = false
  try {
    const client = createPipelineClient(env, fixturesAllowed(env, paper.data.arxivId))
    ;({ picks, charged } = await findResources(
      client,
      batch.map((t) => ({ key: t.data.key, name: t.data.name, description: t.data.description, searchQuery: t.data.searchQuery })),
    ))
  } catch (e) {
    // Put the topics back so the next request can try again.
    for (const t of batch) await tools.update('topics', t.recordId, { resourcesStatus: 'none', resourcesLoadingAt: 0 })
    return { ok: false, error: `Could not load links: ${e instanceof Error ? e.message : String(e)}` }
  }

  let loaded = 0
  let failed = 0
  for (const t of batch) {
    const resources = picks[t.data.key] ?? []
    if (resources.length) loaded++
    else failed++
    await tools.update('topics', t.recordId, {
      resources,
      resourcesStatus: resources.length ? 'ready' : 'failed',
      resourcesLoadingAt: 0,
    })
  }
  return { ok: true, loaded, failed, remaining: due.length - batch.length, busy, charged }
}
