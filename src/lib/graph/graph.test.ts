import { describe, expect, it } from 'vitest'
import { cleanGraph } from './graph'

describe('cleanGraph', () => {
  it('drops dangling and self dependencies and computes tiers', () => {
    const g = cleanGraph([
      { id: 'c1', dependsOn: [] },
      { id: 'c2', dependsOn: ['c1', 'c9', 'c2'] },
      { id: 'c3', dependsOn: ['c2', 'c1'] },
    ])
    expect(g.deps).toEqual({ c1: [], c2: ['c1'], c3: ['c2', 'c1'] })
    expect(g.tiers).toEqual({ c1: 0, c2: 1, c3: 2 })
    expect(g.danglingRemoved).toBe(2)
  })

  it('breaks cycles', () => {
    const g = cleanGraph([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['c'] },
      { id: 'c', dependsOn: ['a'] },
    ])
    expect(g.removedEdges.length).toBe(1)
    // Still a DAG: every tier is finite and consistent.
    for (const id of g.ids) {
      for (const d of g.deps[id]) expect(g.tiers[id]).toBeGreaterThan(g.tiers[d])
    }
  })

  it('removes duplicate ids', () => {
    const g = cleanGraph([
      { id: 'a', dependsOn: [] },
      { id: 'a', dependsOn: [] },
      { id: '', dependsOn: [] },
    ])
    expect(g.ids).toEqual(['a'])
  })
})
