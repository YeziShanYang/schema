/**
 * Branches: 3 to 6 thematic groups of a paper's concepts, chosen by the model
 * once per paper. These helpers clean the model output and compute per-reader
 * progress (known / total) for each branch from the knowledge profile.
 */

import type { Branch, KnowledgeStatus } from '../types'
import { asString } from './json'
import { normalizeTopicKey } from './topics'

export const MAX_BRANCHES = 6
export const OTHER_BRANCH: Branch = { key: 'other', name: 'Other concepts', description: 'Concepts that did not fit a branch.' }

/**
 * Normalizes branch keys, drops duplicates and empty branches, and assigns
 * every concept to a branch. Concepts whose branch is missing go to an
 * "Other concepts" branch, which is added only when needed.
 */
export function cleanBranches(
  rawBranches: unknown,
  concepts: { id: string; branchKey: string }[],
): { branches: Branch[]; branchOf: Record<string, string> } {
  const list = Array.isArray(rawBranches) ? rawBranches : []
  const branches: Branch[] = []
  for (const b of list) {
    if (!b || typeof b !== 'object' || branches.length >= MAX_BRANCHES) continue
    const o = b as Record<string, unknown>
    const name = asString(o.name, 80)
    const key = normalizeTopicKey(asString(o.key, 80) || name)
    if (!key || !name || branches.some((x) => x.key === key)) continue
    branches.push({ key, name, description: asString(o.description, 300) })
  }

  const branchOf: Record<string, string> = {}
  let needOther = false
  for (const c of concepts) {
    const key = normalizeTopicKey(c.branchKey)
    if (branches.some((b) => b.key === key)) {
      branchOf[c.id] = key
    } else {
      branchOf[c.id] = OTHER_BRANCH.key
      needOther = true
    }
  }
  const used = new Set(Object.values(branchOf))
  const kept = branches.filter((b) => used.has(b.key))
  if (needOther && !kept.some((b) => b.key === OTHER_BRANCH.key)) kept.push(OTHER_BRANCH)
  return { branches: kept, branchOf }
}

export interface BranchProgress {
  key: string
  name: string
  description: string
  known: number
  learning: number
  total: number
}

/** Known/total per branch for one reader. `statusOf` gets the concept (knowledge is stored per concept). */
export function branchProgress<C extends { branchKey: string }>(
  branches: Branch[],
  concepts: C[],
  statusOf: (concept: C) => KnowledgeStatus | null,
): BranchProgress[] {
  const rows = (branches.length ? branches : [OTHER_BRANCH]).map((b) => ({ ...b, known: 0, learning: 0, total: 0 }))
  const byKey = new Map(rows.map((r) => [r.key, r]))
  for (const c of concepts) {
    const row = byKey.get(c.branchKey) ?? byKey.get(OTHER_BRANCH.key) ?? rows[0]
    row.total++
    const s = statusOf(c)
    if (s === 'known') row.known++
    else if (s === 'learning') row.learning++
  }
  return rows
}

export function paperProgress<C>(concepts: C[], statusOf: (concept: C) => KnowledgeStatus | null) {
  const total = concepts.length
  const known = concepts.filter((c) => statusOf(c) === 'known').length
  return { known, total, ratio: total ? known / total : 0 }
}
