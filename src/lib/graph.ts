/**
 * Cleans the concept graph a model returns: unique ids, no dangling or self
 * dependencies, no cycles, and a tier for each concept (0 = no prerequisites,
 * otherwise one more than its deepest prerequisite).
 */

export interface RawConceptNode {
  id: string
  dependsOn: string[]
}

export interface CleanGraph {
  /** Ids in input order, duplicates and empty ids removed. */
  ids: string[]
  deps: Record<string, string[]>
  tiers: Record<string, number>
  /** Edges removed to break cycles, as [from, to]. */
  removedEdges: [string, string][]
  danglingRemoved: number
}

export function cleanGraph(nodes: RawConceptNode[]): CleanGraph {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    const id = typeof n.id === 'string' ? n.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  let danglingRemoved = 0
  const deps: Record<string, string[]> = {}
  for (const n of nodes) {
    const id = typeof n.id === 'string' ? n.id.trim() : ''
    if (!seen.has(id) || deps[id]) continue
    const list = Array.isArray(n.dependsOn) ? n.dependsOn : []
    const clean: string[] = []
    for (const d of list) {
      if (typeof d !== 'string' || d === id || !seen.has(d)) {
        danglingRemoved++
        continue
      }
      if (!clean.includes(d)) clean.push(d)
    }
    deps[id] = clean
  }

  // Break cycles with a DFS; any edge into a node on the current stack is dropped.
  const removedEdges: [string, string][] = []
  const state: Record<string, 0 | 1 | 2> = {}
  const visit = (id: string) => {
    state[id] = 1
    for (const d of [...deps[id]]) {
      if (state[d] === 1) {
        deps[id] = deps[id].filter((x) => x !== d)
        removedEdges.push([id, d])
      } else if (!state[d]) {
        visit(d)
      }
    }
    state[id] = 2
  }
  for (const id of ids) if (!state[id]) visit(id)

  const tiers: Record<string, number> = {}
  const tierOf = (id: string): number => {
    if (tiers[id] !== undefined) return tiers[id]
    const t = deps[id].length === 0 ? 0 : 1 + Math.max(...deps[id].map(tierOf))
    tiers[id] = t
    return t
  }
  for (const id of ids) tierOf(id)

  return { ids, deps, tiers, removedEdges, danglingRemoved }
}
