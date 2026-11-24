/**
 * After a paper is re-analyzed its concepts have new record ids, so readers'
 * checkmarks (concept_knowledge rows) would point at concepts that no longer
 * exist. Each such row moves to the new concept with the same normalized name
 * (best effort), taking that concept's name and topic. A row with no match is
 * kept and marked stale; the knowledge page lists it under its paper as "from
 * an earlier analysis". When one reader has two rows that land on the same
 * concept, or already checked the new concept, the extra row is deleted so
 * (userId, conceptId) stays unique.
 */

import { normalizeConceptName } from './topics'

export interface RemapRow {
  recordId: string
  userId: string
  conceptId: string
  conceptName: string
  stale?: boolean
}

export interface RemapConcept {
  conceptId: string
  name: string
  topicKey: string
}

export interface KnowledgeRemapPlan {
  moves: { recordId: string; data: { conceptId: string; conceptName: string; topicKey: string; stale: boolean } | { stale: true } }[]
  deletes: string[]
}

export function planKnowledgeRemap(rows: RemapRow[], concepts: RemapConcept[]): KnowledgeRemapPlan {
  const current = new Set(concepts.map((c) => c.conceptId))
  const byName = new Map<string, RemapConcept>()
  for (const c of concepts) {
    const n = normalizeConceptName(c.name)
    if (n && !byName.has(n)) byName.set(n, c)
  }
  // What each reader already has on the new concepts.
  const taken = new Set(rows.filter((r) => current.has(r.conceptId)).map((r) => `${r.userId}\u0000${r.conceptId}`))

  const plan: KnowledgeRemapPlan = { moves: [], deletes: [] }
  for (const r of rows) {
    if (current.has(r.conceptId)) continue
    const target = byName.get(normalizeConceptName(r.conceptName))
    if (!target) {
      if (!r.stale) plan.moves.push({ recordId: r.recordId, data: { stale: true } })
      continue
    }
    const slot = `${r.userId}\u0000${target.conceptId}`
    if (taken.has(slot)) {
      plan.deletes.push(r.recordId)
      continue
    }
    taken.add(slot)
    plan.moves.push({ recordId: r.recordId, data: { conceptId: target.conceptId, conceptName: target.name, topicKey: target.topicKey, stale: false } })
  }
  return plan
}
