import { describe, expect, it } from 'vitest'
import { branchesCycle, fixBranchPlacement } from './branch-placement'
import type { Branch } from '../types'

const b = (key: string): Branch => ({ key, name: key, description: '' })

describe('fixBranchPlacement', () => {
  // 2611.31122 as stored: LP duality (c3, tier 0) sits in the adaptive branch although the
  // fractional cover (c5, leakage branch) needs it, and the parity tilt (c14) needs the code branch.
  const branches = ['probability', 'leakage', 'rates', 'adaptive', 'codes'].map(b)
  const branchOf = {
    c1: 'probability', c2: 'probability',
    c4: 'leakage', c5: 'leakage', c6: 'leakage',
    c7: 'rates', c8: 'rates', c16: 'rates',
    c3: 'adaptive', c9: 'adaptive', c10: 'adaptive', c14: 'adaptive',
    c11: 'codes', c12: 'codes', c13: 'codes', c15: 'codes',
  }
  const deps: Record<string, string[]> = {
    c1: [], c2: ['c1'], c3: [], c4: ['c2'], c5: ['c3', 'c4'], c6: ['c4'], c7: ['c5'], c8: ['c5'], c9: ['c3'], c10: ['c9', 'c3'],
    c11: ['c1'], c12: ['c11'], c13: ['c11', 'c1'], c14: ['c13', 'c10'], c15: ['c10', 'c12'], c16: ['c7', 'c5'],
  }
  const tiers = { c1: 0, c2: 1, c3: 0, c4: 2, c5: 3, c6: 3, c7: 4, c8: 4, c9: 1, c10: 2, c11: 1, c12: 2, c13: 2, c14: 3, c15: 3, c16: 5 }

  it('moves a foundation to the earlier branch that uses it, and a concept to the later branch it builds on', () => {
    const out = fixBranchPlacement(branches, branchOf, deps, tiers)
    expect(out.moves).toEqual([
      { conceptId: 'c3', from: 'adaptive', to: 'leakage', rule: 'foundation-to-earlier-user' },
      { conceptId: 'c14', from: 'adaptive', to: 'codes', rule: 'to-latest-prerequisite' },
    ])
    expect(out).toMatchObject({ cycleBefore: true, cycleAfter: false })
    expect(branchesCycle(branches, out.branchOf, deps)).toBe(false)
  })

  it('moves a concept whose prerequisites all lie in later branches into the latest of them', () => {
    // 2611.29886: heterarchical control (c19) sits among the control foundations but builds on strategic and agentic control.
    const out = fixBranchPlacement(
      ['sensing', 'control', 'strategic', 'agentic'].map(b),
      { c1: 'sensing', c2: 'sensing', c3: 'control', c4: 'control', c19: 'control', c10: 'strategic', c11: 'strategic', c15: 'agentic', c16: 'agentic' },
      { c1: [], c2: ['c1'], c3: ['c1'], c4: ['c3'], c19: ['c10', 'c15'], c10: ['c3', 'c11'], c11: ['c2'], c15: ['c10'], c16: ['c15'] },
      { c1: 0, c2: 1, c3: 1, c4: 2, c19: 5, c10: 3, c11: 2, c15: 4, c16: 5 },
    )
    expect(out.moves).toEqual([{ conceptId: 'c19', from: 'control', to: 'agentic', rule: 'to-latest-prerequisite' }])
    expect(out.cycleAfter).toBe(false)
  })

  it('leaves branches that form no cycle alone, even with a dependency on a later branch', () => {
    const out = fixBranchPlacement([b('a'), b('b')], { a1: 'a', a2: 'a', b1: 'b', b2: 'b' }, { a1: ['b1'], a2: [], b1: [], b2: [] }, { a1: 1, a2: 0, b1: 0, b2: 0 })
    expect(out).toEqual({ branchOf: { a1: 'a', a2: 'a', b1: 'b', b2: 'b' }, moves: [], cycleBefore: false, cycleAfter: false })
  })

  it('never leaves a branch with one concept, and reports a cycle it could not break', () => {
    // a1 (tier 0) is used by b1 in the earlier branch b... but moving it would leave a with one concept.
    const out = fixBranchPlacement(
      [b('b'), b('a')],
      { b1: 'b', b2: 'b', a1: 'a', a2: 'a' },
      { b1: ['a1'], b2: [], a1: [], a2: ['b2'] },
      { b1: 1, b2: 0, a1: 0, a2: 1 },
    )
    expect(out.moves).toEqual([])
    expect(out).toMatchObject({ cycleBefore: true, cycleAfter: true })
  })
})
