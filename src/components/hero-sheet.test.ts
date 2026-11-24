import { describe, expect, it } from 'vitest'
import { demoSnapshot, type DemoSnapshot } from '../data/demo'
import { HERO_PICKS, heroPicks } from './HeroSheet'

describe('heroPicks', () => {
  it('resolves every pick against the bundled snapshot', () => {
    const picks = heroPicks(demoSnapshot)
    expect(picks.map((p) => p.concept.key)).toEqual(HERO_PICKS.map((p) => p.key))
    for (const p of picks) expect((p.concept.quoteDisplay || p.concept.quote).includes(p.phrase)).toBe(true)
  })

  it('takes a math phrase from quoteDisplay, not the verbatim quote', () => {
    const math = heroPicks(demoSnapshot).find((p) => p.phrase.includes('\\('))
    expect(math).toBeDefined()
    expect(math!.concept.quote.includes(math!.phrase)).toBe(false)
    expect(math!.concept.quoteDisplay?.includes(math!.phrase)).toBe(true)
  })

  it('drops a pick whose phrase is no longer in the quote, or whose concept is gone', () => {
    const [first, second] = HERO_PICKS
    const snap: DemoSnapshot = {
      ...demoSnapshot,
      branches: [
        {
          key: 'b',
          name: 'B',
          description: '',
          concepts: demoSnapshot.branches
            .flatMap((b) => b.concepts)
            .filter((c) => c.key === first.key)
            .map((c) => ({ ...c, quote: 'A different sentence.', quoteDisplay: '' })),
        },
      ],
    }
    expect(heroPicks(snap)).toEqual([])
    expect(heroPicks({ ...snap, branches: [] }).some((p) => p.concept.key === second.key)).toBe(false)
  })
})
