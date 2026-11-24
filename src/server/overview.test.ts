import { describe, expect, it } from 'vitest'
import { parseOverview, type OverviewConcept } from './overview'
import { fixtureIntegration } from './pipeline/fixtures'
import { findMessage } from './pipeline/llm'
import { extractJsonObject } from '../lib/json'

const concepts: OverviewConcept[] = [
  { key: 'c1', name: 'Softmax', whyNeeded: '', section: '2', order: 0 },
  { key: 'c2', name: 'Attention', whyNeeded: '', section: '1', order: 1 },
  { key: 'c3', name: 'Second fundamental form', whyNeeded: '', section: '3', order: 2 },
  { key: 'c4', name: 'Gradient descent', whyNeeded: '', section: '4', order: 3 },
]

function fixtureJson(): Record<string, unknown> {
  const msg = findMessage(fixtureIntegration('anthropic/chat-completion', {}, 'overview'))
  const text = msg?.content?.map((p) => p.text ?? '').join('') ?? ''
  return extractJsonObject(text) as Record<string, unknown>
}

describe('parseOverview', () => {
  it('keeps known concept keys, numbers the story and lists unused concepts as also needed', () => {
    const { overview, roles } = parseOverview(fixtureJson(), concepts, 123)
    expect(overview.plain).toMatch(/^Attention lets a model/)
    expect(overview.story.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(overview.story[2].conceptKeys).toEqual(['c3', 'c2'])
    expect(overview.story[0].technical).toMatch(/^Here the paper uses/)
    expect(overview.alsoNeeded).toEqual(['c4'])
    expect(overview.generatedAt).toBe(123)
    expect(Object.keys(roles).sort()).toEqual(['c1', 'c2', 'c3'])
  })

  it('caps the story at 8 items and 4 concepts per item, and drops empty items', () => {
    const story = Array.from({ length: 11 }, (_, i) => ({ text: i === 0 ? '' : `Step ${i}`, technical: '', concept_keys: ['c1', 'c2', 'c3', 'c4', 'c1'] }))
    const { overview } = parseOverview({ plain: 'A plain summary.', story }, concepts)
    expect(overview.story).toHaveLength(8)
    expect(overview.story[0].text).toBe('Step 1')
    expect(overview.story[0].conceptKeys).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(overview.alsoNeeded).toEqual([])
  })

  it('keeps a quote_display only when its words still match the verbatim quote', () => {
    const quoted: OverviewConcept[] = [
      { ...concepts[0], quote: 'The norm is ∥A∥2g = ⟨A, A⟩g for every tensor in the layer.' },
      { ...concepts[1], quote: 'We set ⟨A, B⟩g = g ia g jb Aij Bab for the metric.' },
    ]
    const { quoteDisplays } = parseOverview(
      {
        plain: 'A summary.',
        story: [{ text: 'One.' }, { text: 'Two.' }],
        roles: [
          { key: 'c1', plain_role: 'r', quote_display: 'The norm is \\(\\|A\\|_g^2 = \\langle A, A\\rangle_g\\) for every tensor in the layer.' },
          { key: 'c2', plain_role: 'r', quote_display: 'We define an inner product \\(\\langle A, B\\rangle_g\\) for all matrices.' },
        ],
      },
      quoted,
    )
    expect(Object.keys(quoteDisplays)).toEqual(['c1'])
  })

  it('refuses an overview without a summary or with fewer than two story items', () => {
    expect(() => parseOverview({ plain: '', story: [{ text: 'a' }, { text: 'b' }] }, concepts)).toThrow()
    expect(() => parseOverview({ plain: 'Summary.', story: [{ text: 'only one' }] }, concepts)).toThrow()
  })
})
