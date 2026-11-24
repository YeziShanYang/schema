/**
 * A branch with one concept reads as noise on the paper page, so it is
 * merged: into the branch holding most of the concept's dependency
 * neighbours (what it depends on and what depends on it), ties going to the
 * earlier branch, or into "Other concepts" when it has no neighbours outside
 * its own branch. Runs after cleanBranches, on the cleaned graph.
 */

import type { Branch } from '../types'
import { OTHER_BRANCH } from './branches'

export interface BranchMerge {
  conceptId: string
  from: string
  to: string
}

export function mergeSingletonBranches(
  branches: Branch[],
  branchOf: Record<string, string>,
  deps: Record<string, string[]>,
): { branches: Branch[]; branchOf: Record<string, string>; merges: BranchMerge[] } {
  const of = { ...branchOf }
  let list = [...branches]
  const merges: BranchMerge[] = []
  const members = (key: string) => Object.keys(of).filter((id) => of[id] === key)
  const neighbours = (id: string) => [
    ...(deps[id] ?? []),
    ...Object.keys(deps).filter((other) => (deps[other] ?? []).includes(id)),
  ]

  // Each pass merges at most one branch; a merged branch is gone, so this ends.
  for (let guard = 0; guard < branches.length + 1; guard++) {
    if (list.length < 2) break
    const single = list.find((b) => members(b.key).length === 1 && !(b.key === OTHER_BRANCH.key && !hasOutsideNeighbour(b.key)))
    if (!single) break
    const [id] = members(single.key)
    const tally = new Map<string, number>()
    for (const n of neighbours(id)) {
      const b = of[n]
      if (b && b !== single.key) tally.set(b, (tally.get(b) ?? 0) + 1)
    }
    let to = ''
    let best = 0
    for (const b of list) {
      const n = tally.get(b.key) ?? 0
      if (n > best) {
        best = n
        to = b.key
      }
    }
    if (!to) {
      if (single.key === OTHER_BRANCH.key) break
      to = OTHER_BRANCH.key
      if (!list.some((b) => b.key === OTHER_BRANCH.key)) list.push(OTHER_BRANCH)
    }
    of[id] = to
    merges.push({ conceptId: id, from: single.key, to })
    list = list.filter((b) => b.key !== single.key)
  }

  function hasOutsideNeighbour(key: string): boolean {
    return members(key).some((id) => neighbours(id).some((n) => of[n] && of[n] !== key))
  }

  // "Other concepts" stays last.
  const other = list.find((b) => b.key === OTHER_BRANCH.key)
  if (other) list = [...list.filter((b) => b !== other), other]
  return { branches: list, branchOf: of, merges }
}
