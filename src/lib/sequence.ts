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
 *
 * `statusOf` gets the concept itself: knowledge is stored per concept, so the
 * caller looks it up by the concept's record id.
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
  /** The concept's record id, which per-concept knowledge is keyed by. */
  id?: string
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

/**
 * The branches in learning order (see the file header). `cycle` is true when
 * at some point no remaining branch had all its prerequisite branches
 * placed, so the model's order decided: the branches' dependencies form a cycle.
 */
export function branchOrder<B extends SeqBranch>(
  branches: B[],
  concepts: Pick<SeqConcept, 'key' | 'branchKey' | 'dependsOn'>[],
): { ordered: B[]; cycle: boolean } {
  const modelRank = new Map(branches.map((b, i) => [b.key, i]))
  const sizes = new Map<string, number>()
  for (const c of concepts) sizes.set(c.branchKey, (sizes.get(c.branchKey) ?? 0) + 1)
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
  const remaining = modelOrder.filter((b) => (sizes.get(b.key) ?? 0) > 0)
  const ordered: B[] = []
  const placed = new Set<string>()
  let cycle = false
  while (remaining.length) {
    // The earliest branch (in model order) whose prerequisite branches are all placed; on a cycle, the earliest.
    const ready = remaining.findIndex((b) => [...(prereqs.get(b.key) ?? [])].every((p) => placed.has(p)))
    if (ready === -1) cycle = true
    const [next] = remaining.splice(Math.max(0, ready), 1)
    ordered.push(next)
    placed.add(next.key)
  }
  ordered.push(...modelOrder.filter((b) => !placed.has(b.key)))
  return { ordered, cycle }
}

export function recommendedSequence<C extends SeqConcept>(
  branches: SeqBranch[],
  concepts: C[],
  statusOf: (concept: C) => KnowledgeStatus | null,
): Sequence<C> {
  const byBranch = new Map<string, C[]>()
  for (const c of concepts) {
    const list = byBranch.get(c.branchKey) ?? []
    list.push(c)
    byBranch.set(c.branchKey, list)
  }
  const orderedBranches = branchOrder(branches, concepts).ordered
  const branchRank = new Map(orderedBranches.map((b, i) => [b.key, i]))
  const rankOf = (key: string) => branchRank.get(key) ?? orderedBranches.length

  const ordered = [...concepts].sort(
    (a, b) => rankOf(a.branchKey) - rankOf(b.branchKey) || (a.tier ?? 0) - (b.tier ?? 0) || (a.order ?? 0) - (b.order ?? 0),
  )

  const byKey = new Map(concepts.map((c) => [c.key, c]))
  const isKnown = (c: C) => statusOf(c) === 'known'
  const ready = (c: C) =>
    (c.dependsOn ?? []).every((d) => {
      const dep = byKey.get(d)
      if (!dep) return true
      return statusOf(dep) === 'known'
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

/** The longest step label the strip shows before cutting it. */
export const STEP_LABEL_MAX = 24

/** Words a cut label may not end on before its ellipsis ("Linear algebra and…" reads as "Linear algebra…"). */
const TRAILING_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'onto', 'over',
  'under', 'via', 'as', 'its', 'their', 'vs', 'versus',
])

const TRAILING_PUNCTUATION = /[\s,;:.\-–—&]+$/

/**
 * A step-strip label: the branch name, or, when it is longer than `max`
 * characters, its first `max - 1` characters with an ellipsis. The cut moves
 * back to the last word break when one falls in the final 8 characters, so a
 * word is cut only when it would leave a much shorter label. A cut at a word
 * break drops trailing function words ("and", "of", "the") and punctuation
 * before the ellipsis, unless that would leave nothing.
 */
export function stepLabel(name: string, max = STEP_LABEL_MAX): string {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const head = clean.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  const atBreak = space >= max - 8
  let cut = (atBreak ? head.slice(0, space) : head).replace(TRAILING_PUNCTUATION, '')
  if (atBreak) {
    for (;;) {
      const words = cut.split(' ')
      if (words.length < 2 || !TRAILING_FUNCTION_WORDS.has(words[words.length - 1].toLowerCase())) break
      cut = words.slice(0, -1).join(' ').replace(TRAILING_PUNCTUATION, '')
    }
  }
  return `${cut}…`
}
