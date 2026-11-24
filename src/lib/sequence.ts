/**
 * Recommended learning sequence for one paper, computed from stored fields
 * only (no model call): branch order, concept order and the next concept to
 * learn for the current reader.
 *
 * - Branches keep the model's order (its prompt lists foundational branches
 *   first), moved only so that a branch comes after every branch it depends
 *   on: when a concept in B depends on a concept in A, A goes first. A cycle
 *   between branches falls back to the model's order. Branches with no
 *   concepts go last.
 * - Concepts go branch by branch in that order, then by tier, then by the
 *   model's order.
 * - Next up is the first concept that is not known and whose prerequisites
 *   are all known; failing that, the first concept not known.
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
  // Branch-level prerequisites from concept dependencies that cross branches.
  const branchOfConcept = new Map(concepts.map((c) => [c.key, c.branchKey]))
  const prereqs = new Map<string, Set<string>>(branches.map((b) => [b.key, new Set<string>()]))
  for (const c of concepts) {
    for (const d of c.dependsOn ?? []) {
      const from = branchOfConcept.get(d)
      if (from && from !== c.branchKey && prereqs.has(from)) prereqs.get(c.branchKey)?.add(from)
    }
  }
  const modelOrder = [...branches].sort((a, b) => modelRank.get(a.key)! - modelRank.get(b.key)!)
  const remaining = modelOrder.filter((b) => (byBranch.get(b.key)?.length ?? 0) > 0)
  const orderedBranches: SeqBranch[] = []
  const placed = new Set<string>()
  while (remaining.length) {
    // The earliest branch (in model order) whose prerequisite branches are all placed; on a cycle, the earliest.
    const i = Math.max(0, remaining.findIndex((b) => [...(prereqs.get(b.key) ?? [])].every((p) => placed.has(p))))
    const [next] = remaining.splice(i, 1)
    orderedBranches.push(next)
    placed.add(next.key)
  }
  orderedBranches.push(...modelOrder.filter((b) => !placed.has(b.key)))
  const branchRank = new Map(orderedBranches.map((b, i) => [b.key, i]))
  const rankOf = (key: string) => branchRank.get(key) ?? orderedBranches.length

  const ordered = [...concepts].sort(
    (a, b) => rankOf(a.branchKey) - rankOf(b.branchKey) || (a.tier ?? 0) - (b.tier ?? 0) || (a.order ?? 0) - (b.order ?? 0),
  )

  const byKey = new Map(concepts.map((c) => [c.key, c]))
  const isKnown = (c: C) => statusOf(c.topicKey) === 'known'
  const ready = (c: C) =>
    (c.dependsOn ?? []).every((d) => {
      const dep = byKey.get(d)
      if (!dep) return true
      return statusOf(dep.topicKey) === 'known'
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
