/**
 * Recommended learning sequence for one paper, computed from stored fields
 * only (no model call): branch order, concept order and the next concept to
 * learn for the current reader.
 *
 * - Branches go by the mean tier of their concepts, ascending; ties keep the
 *   model's branch order (its prompt lists foundational branches first).
 * - Concepts go by tier, then branch order, then the model's order.
 * - Next up is the first concept that is not known and whose prerequisites
 *   are all known or learning; failing that, the first concept not known.
 */

import type { KnowledgeStatus } from '../types'

export interface SeqBranch {
  key: string
  name: string
}

export interface SeqConcept {
  key: string
  name: string
  tier: number
  order: number
  branchKey: string
  topicKey: string
  dependsOn: string[]
}

export type StepState = 'done' | 'current' | 'upcoming'

export interface SequenceStep {
  index: number
  branchKey: string
  name: string
  known: number
  total: number
  done: boolean
  state: StepState
  meanTier: number
}

export interface Sequence<C extends SeqConcept = SeqConcept> {
  steps: SequenceStep[]
  /** Every concept in learning order. */
  concepts: C[]
  nextUp: C | null
  allKnown: boolean
  /** True when the reader knows nothing in this paper yet ("Start here" rather than "Continue"). */
  fresh: boolean
  /** Concept key -> its 1-based position within its branch, in sequence order. */
  stepInBranch: Map<string, number>
}

export function recommendedSequence<C extends SeqConcept>(
  branches: SeqBranch[],
  concepts: C[],
  statusOf: (topicKey: string) => KnowledgeStatus | null,
): Sequence<C> {
  const modelRank = new Map(branches.map((b, i) => [b.key, i]))
  const byBranch = new Map<string, C[]>()
  for (const c of concepts) {
    const list = byBranch.get(c.branchKey) ?? []
    list.push(c)
    byBranch.set(c.branchKey, list)
  }
  const mean = (key: string) => {
    const list = byBranch.get(key) ?? []
    return list.length ? list.reduce((s, c) => s + (c.tier ?? 0), 0) / list.length : Number.POSITIVE_INFINITY
  }
  const orderedBranches = [...branches].sort((a, b) => mean(a.key) - mean(b.key) || (modelRank.get(a.key)! - modelRank.get(b.key)!))
  const branchRank = new Map(orderedBranches.map((b, i) => [b.key, i]))
  const rankOf = (key: string) => branchRank.get(key) ?? orderedBranches.length

  const ordered = [...concepts].sort(
    (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || rankOf(a.branchKey) - rankOf(b.branchKey) || (a.order ?? 0) - (b.order ?? 0),
  )

  const byKey = new Map(concepts.map((c) => [c.key, c]))
  const isKnown = (c: C) => statusOf(c.topicKey) === 'known'
  const ready = (c: C) =>
    (c.dependsOn ?? []).every((d) => {
      const dep = byKey.get(d)
      if (!dep) return true
      const s = statusOf(dep.topicKey)
      return s === 'known' || s === 'learning'
    })

  const nextUp = ordered.find((c) => !isKnown(c) && ready(c)) ?? ordered.find((c) => !isKnown(c)) ?? null
  const allKnown = ordered.length > 0 && nextUp === null
  const fresh = !ordered.some(isKnown)

  const steps: SequenceStep[] = orderedBranches.map((b, i) => {
    const list = byBranch.get(b.key) ?? []
    const known = list.filter(isKnown).length
    const done = list.length > 0 && known === list.length
    return {
      index: i + 1,
      branchKey: b.key,
      name: b.name,
      known,
      total: list.length,
      done,
      state: done ? 'done' : nextUp?.branchKey === b.key ? 'current' : 'upcoming',
      meanTier: mean(b.key),
    }
  })

  const stepInBranch = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const c of ordered) {
    const n = (seen.get(c.branchKey) ?? 0) + 1
    seen.set(c.branchKey, n)
    stepInBranch.set(c.key, n)
  }

  return { steps, concepts: ordered, nextUp, allKnown, fresh, stepInBranch }
}
