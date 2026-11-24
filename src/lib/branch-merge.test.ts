import { describe, expect, it } from 'vitest'
import { mergeSingletonBranches } from './branch-merge'
import { OTHER_BRANCH } from './branches'
import type { Branch } from '../types'

const b = (key: string): Branch => ({ key, name: key, description: '' })

describe('mergeSingletonBranches', () => {
  it('merges a one-concept branch into the branch holding most of its dependency neighbours', () => {
    const { branches, branchOf, merges } = mergeSingletonBranches(
      [b('basics'), b('model'), b('tiny')],
      { c1: 'basics', c2: 'basics', c3: 'model', c4: 'model', c5: 'tiny' },
      { c1: [], c2: [], c3: ['c1'], c4: ['c3'], c5: ['c3', 'c4', 'c1'] },
    )
    expect(branches.map((x) => x.key)).toEqual(['basics', 'model'])
    expect(branchOf.c5).toBe('model')
    expect(merges).toEqual([{ conceptId: 'c5', from: 'tiny', to: 'model' }])
  })

  it('counts dependents as neighbours too, and breaks ties toward the earlier branch', () => {
    const { branchOf } = mergeSingletonBranches(
      [b('a'), b('b'), b('solo')],
      { a1: 'a', a2: 'a', b1: 'b', b2: 'b', s: 'solo' },
      { a1: [], a2: ['s'], b1: ['s'], b2: [], s: [] },
    )
    expect(branchOf.s).toBe('a')
  })

  it('moves a concept with no neighbours outside its branch to Other concepts, last', () => {
    const { branches, branchOf } = mergeSingletonBranches(
      [b('a'), b('lonely'), b('c')],
      { a1: 'a', a2: 'a', l: 'lonely', c1: 'c', c2: 'c' },
      { a1: [], a2: [], l: [], c1: [], c2: [] },
    )
    expect(branchOf.l).toBe(OTHER_BRANCH.key)
    expect(branches.map((x) => x.key)).toEqual(['a', 'c', OTHER_BRANCH.key])
  })

  it('leaves branches with two or more concepts, and a lone paper, alone', () => {
    const input = { c1: 'a', c2: 'a', c3: 'b', c4: 'b' }
    expect(mergeSingletonBranches([b('a'), b('b')], input, {}).merges).toEqual([])
    expect(mergeSingletonBranches([b('a')], { c1: 'a' }, {}).branches.map((x) => x.key)).toEqual(['a'])
  })
})
