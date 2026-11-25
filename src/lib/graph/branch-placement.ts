/**
 * Moves concepts the model filed in a branch that makes the branches'
 * dependencies circular, so the recommended sequence (lib/graph/sequence) can put
 * every branch after the branches it builds on instead of falling back to
 * the model's order. It runs on the cleaned graph after mergeSingletonBranches,
 * and only when the branches form a cycle. Two kinds of move, repeated until
 * the cycle is gone or neither applies:
 * - a foundation (tier 0, no prerequisites) that a concept in an earlier
 *   branch depends on moves to the earliest such branch;
 * - a concept whose prerequisites outside its own branch all lie in later
 *   branches moves to the latest of those.
 * A move is kept only when it lowers the number of dependencies that point
 * to a later branch, and never when it would leave its branch with one
 * concept, so the single-concept rule of branch-merge still holds. Branch
 * order is the order of `branches` (the model's, with "Other concepts" last).
 */

import type { Branch } from '../../types'
import { branchOrder } from './sequence'

export type PlacementRule = 'foundation-to-earlier-user' | 'to-latest-prerequisite'

export interface BranchMove {
  conceptId: string
  from: string
  to: string
  rule: PlacementRule
}

export interface Placement {
  branchOf: Record<string, string>
  moves: BranchMove[]
  /** Whether the branches formed a cycle before the moves and after them. */
  cycleBefore: boolean
  cycleAfter: boolean
}

export function branchesCycle(branches: Branch[], branchOf: Record<string, string>, deps: Record<string, string[]>): boolean {
  const concepts = Object.keys(branchOf).map((id) => ({ key: id, branchKey: branchOf[id], dependsOn: deps[id] ?? [] }))
  return branchOrder(branches, concepts).cycle
}

export function fixBranchPlacement(
  branches: Branch[],
  branchOf: Record<string, string>,
  deps: Record<string, string[]>,
  tiers: Record<string, number>,
): Placement {
  const of = { ...branchOf }
  const moves: BranchMove[] = []
  const cycleBefore = branchesCycle(branches, of, deps)
  if (!cycleBefore) return { branchOf: of, moves, cycleBefore, cycleAfter: false }

  const ids = Object.keys(of)
  const rankOf = new Map(branches.map((b, i) => [b.key, i]))
  const rank = (id: string) => rankOf.get(of[id]) ?? branches.length
  const dependents = (id: string) => ids.filter((x) => (deps[x] ?? []).includes(id))
  const size = (key: string) => ids.filter((x) => of[x] === key).length
  const backward = () => ids.reduce((n, x) => n + (deps[x] ?? []).filter((d) => d in of && rank(d) > rank(x)).length, 0)

  const tryMove = (id: string, to: string, rule: PlacementRule): boolean => {
    const from = of[id]
    if (to === from || size(from) <= 2) return false
    const before = backward()
    of[id] = to
    if (backward() >= before) {
      of[id] = from
      return false
    }
    moves.push({ conceptId: id, from, to, rule })
    return true
  }

  const byRank = (keys: string[]) => [...new Set(keys)].sort((a, b) => (rankOf.get(a) ?? branches.length) - (rankOf.get(b) ?? branches.length))

  // Every kept move lowers the count of backward dependencies, so this ends.
  for (let guard = 0; guard <= ids.length * 2; guard++) {
    let moved = false
    for (const id of ids) {
      if ((tiers[id] ?? 0) !== 0 || (deps[id] ?? []).length) continue
      const users = dependents(id).filter((u) => rank(u) < rank(id))
      if (users.length && tryMove(id, byRank(users.map((u) => of[u]))[0], 'foundation-to-earlier-user')) {
        moved = true
        break
      }
    }
    if (!moved) {
      for (const id of ids) {
        const outside = (deps[id] ?? []).filter((d) => d in of && of[d] !== of[id])
        if (!outside.length || !outside.every((d) => rank(d) > rank(id))) continue
        if (tryMove(id, byRank(outside.map((d) => of[d])).at(-1)!, 'to-latest-prerequisite')) {
          moved = true
          break
        }
      }
    }
    if (!moved || !branchesCycle(branches, of, deps)) break
  }
  return { branchOf: of, moves, cycleBefore, cycleAfter: branchesCycle(branches, of, deps) }
}
