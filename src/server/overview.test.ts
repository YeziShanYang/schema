import { describe, expect, it } from 'vitest'
import { parseOverview, type OverviewConcept } from './overview'
import { fixtureIntegration } from './pipeline/fixtures'
import { findMessage } from './pipeline/llm'
import { extractJsonObject } from '../lib/json'

const concepts: OverviewConcept[] = ['c1', 'c5', 'c2', 'c6', 'c3', 'c7', 'c9', 'c4', 'c8'].map((key, order) => ({ key, name: key, whyNeeded: '', section: '1', order }))

function fixtureJson(): Record<string, unknown> {
  const msg = findMessage(fixtureIntegration('anthropic/chat-completion', {}, 'overview'))
  const text = msg?.content?.map((p) => p.text ?? '').join('') ?? ''
  return extractJsonObject(text) as Record<string, unknown>
}

describe('parseOverview', () => {
  it('keeps known concept keys, numbers the story and lists unused concepts as also needed', () => {
    const { overview, roles } = parseOverview(fixtureJson(), concepts, 123)
    expect(overview.plain).toMatch(/^Attention lets a model/)
    expect(overview.story.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(overview.story[3].conceptKeys).toEqual(['c3', 'c7'])
    expect(overview.story[0].technical).toMatch(/^Here the paper uses/)
    expect(overview.alsoNeeded).toEqual(['c5', 'c4', 'c8'])
    expect(overview.generatedAt).toBe(123)
    expect(Object.keys(roles).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
  })

  it('caps the story at 8 items and 4 concepts per item, and drops empty items', () => {
    const story = Array.from({ length: 11 }, (_, i) => ({ text: i === 0 ? '' : `Step ${i}`, technical: '', concept_keys: ['c1', 'c2', 'c3', 'c4', 'c1'] }))
    const { overview } = parseOverview({ plain: 'A plain summary.', story }, concepts)
    expect(overview.story).toHaveLength(8)
    expect(overview.story[0].text).toBe('Step 1')
    expect(overview.story[0].conceptKeys).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(overview.alsoNeeded).toEqual(['c5', 'c6', 'c7', 'c9', 'c8'])
  })

  it('gives a concept the model left without a role the first sentence of its why-needed line', () => {
    const lp: OverviewConcept = {
      key: 'c3',
      name: 'Linear programming and duality',
      whyNeeded: 'The optimal guessing factor is the value of a linear program, and the matching lower bounds come from its dual. More follows.',
      section: '2',
      order: 0,
    }
    const story = [{ text: 'One.', concept_keys: ['c3'] }, { text: 'Two.', concept_keys: [] }]
    const { roles } = parseOverview({ plain: 'Summary.', story, roles: [{ key: 'c1', plain_role: 'Kept as written.' }] }, [...concepts, lp])
    expect(roles.c3).toBe('The optimal guessing factor is the value of a linear program, and the matching lower bounds come from its dual.')
    expect(roles.c1).toBe('Kept as written.')
    // A concept with no why-needed line stays without a role.
    expect(roles.c2).toBeUndefined()
  })

  it('refuses an overview without a summary or with fewer than two story items', () => {
    expect(() => parseOverview({ plain: '', story: [{ text: 'a' }, { text: 'b' }] }, concepts)).toThrow()
    expect(() => parseOverview({ plain: 'Summary.', story: [{ text: 'only one' }] }, concepts)).toThrow()
  })
})
