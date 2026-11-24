/**
 * Recommends target papers for a workspace: one Exa search restricted to
 * arxiv.org, one Haiku call to rank and pick three, then each pick is checked
 * against the arXiv API before it is stored. Picks that fail the check are
 * dropped, so a stored suggestion always names a real paper.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, KnowledgeData, Suggestion, TopicData, WorkspaceData } from '../types'
import { parseArxivId } from '../lib/arxiv'
import { asString } from '../lib/json'
import { lookupArxiv } from './pipeline/arxiv-meta'
import { createPipelineClient, fixtureWorkspace } from './pipeline/client'
import { callModelJson } from './pipeline/llm'
import { RECOMMEND_SYSTEM, recommendUser, type PaperCandidate } from './pipeline/prompts'

const PICKS = 3
const MAX_CANDIDATES = 10

export function searchQueryFor(ws: Pick<WorkspaceData, 'name' | 'description'>, knownTopics: string[]): string {
  const focus = ws.description ? `${ws.name}: ${ws.description}` : ws.name
  if (knownTopics.length < 8) return `An introductory survey or tutorial paper on ${focus}`
  return `A research paper on ${focus} for a reader who already knows ${knownTopics.slice(0, 5).join(', ')}`
}

/** arXiv ids from Exa results, deduped, skipping papers already in the workspace. */
export function candidatesFromResults(results: unknown, skip: Set<string>): PaperCandidate[] {
  if (!Array.isArray(results)) return []
  const out: PaperCandidate[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const ref = parseArxivId(asString(o.url, 500))
    if (!ref || seen.has(ref.id) || skip.has(ref.id)) continue
    seen.add(ref.id)
    out.push({
      n: out.length + 1,
      arxivId: ref.id,
      title: asString(o.title, 300) || ref.id,
      snippet: asString(o.text ?? o.summary, 3000).replace(/\s+/g, ' ').slice(0, 300),
    })
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

export type RecommendOutcome = { ok: true; suggestions: Suggestion[] } | { ok: false; error: string; charged: boolean }

export async function recommendForWorkspace(
  env: Env,
  tools: ActionTools,
  userId: string,
  workspace: Envelope<WorkspaceData>,
): Promise<RecommendOutcome> {
  const ws = workspace.data
  const known = await tools.query('knowledge', { where: { userId, status: 'known' }, limit: 1000 })
  const topicsRes = await tools.query('topics', { limit: 5000 })
  const names = new Map<string, string>()
  if (topicsRes.success) {
    for (const t of topicsRes.data.records as unknown as Envelope<TopicData>[]) names.set(t.data.key, t.data.name)
  }
  const knownTopics = known.success
    ? (known.data.records as unknown as Envelope<KnowledgeData>[]).map((k) => names.get(k.data.topicKey) ?? k.data.topicKey)
    : []

  const fixtures = fixtureWorkspace(env, ws.name)
  const client = createPipelineClient(env, fixtures)
  const existing = new Set((ws.papers ?? []).map((p) => p.arxivId))

  let results: unknown
  try {
    const data = (await client.call(
      'exa/search',
      {
        query: searchQueryFor(ws, knownTopics),
        numResults: 12,
        includeDomains: ['arxiv.org'],
        category: 'research paper',
      },
      'search',
    )) as { results?: unknown }
    results = data?.results
  } catch (e) {
    return { ok: false, charged: false, error: `Paper search failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const candidates = candidatesFromResults(results, existing)
  if (candidates.length === 0) {
    return { ok: false, charged: true, error: 'No arXiv papers matched this workspace. Try adding a description.' }
  }

  let picks: { candidate: PaperCandidate; reason: string }[] = []
  try {
    const json = await callModelJson(client, {
      system: RECOMMEND_SYSTEM,
      user: recommendUser({
        name: ws.name,
        description: ws.description,
        knownTopics: knownTopics.slice(0, 40),
        existing: (ws.papers ?? []).map((p) => p.title || p.arxivId),
        candidates,
      }),
      maxTokens: 4000,
      hint: 'recommend',
    })
    const list = Array.isArray(json.picks) ? json.picks : []
    for (const p of list) {
      if (!p || typeof p !== 'object') continue
      const n = Number((p as Record<string, unknown>).n)
      const candidate = candidates.find((c) => c.n === n)
      if (!candidate || picks.some((x) => x.candidate.arxivId === candidate.arxivId)) continue
      picks.push({ candidate, reason: asString((p as Record<string, unknown>).reason, 300) })
    }
  } catch (e) {
    console.warn(`[recommend] ranking failed, falling back to search order: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (picks.length === 0) {
    picks = candidates.slice(0, PICKS).map((candidate) => ({ candidate, reason: 'Top match from the paper search.' }))
  }

  const suggestions: Suggestion[] = []
  for (const p of picks.slice(0, PICKS)) {
    const lookup = await lookupArxiv(p.candidate.arxivId, { fixtures })
    if (!lookup.ok) continue
    suggestions.push({
      arxivId: lookup.meta.id,
      title: lookup.meta.title,
      authors: lookup.meta.authors.slice(0, 6),
      reason: p.reason,
    })
  }
  if (suggestions.length === 0) {
    return { ok: false, charged: true, error: 'None of the recommended papers could be confirmed on arXiv. Try again.' }
  }
  return { ok: true, suggestions }
}
