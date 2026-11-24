import { describe, expect, it } from 'vitest'
import { demoSnapshot, type DemoSnapshot } from '../data/demo'
import { H, HERO_PICKS, HERO_SLOTS, W, heroLink, heroPicks } from './HeroSheet'

const concepts = demoSnapshot.branches.flatMap((b) => b.concepts)

describe('heroPicks', () => {
  it('resolves every pick by name against the bundled snapshot', () => {
    const picks = heroPicks(demoSnapshot)
    expect(picks.map((p) => p.concept.name)).toEqual(HERO_PICKS.map((p) => p.name))
    for (const p of picks) expect((p.concept.quoteDisplay || p.concept.quote).includes(p.phrase)).toBe(true)
  })

  it('takes a math phrase from quoteDisplay, not the verbatim quote', () => {
    const math = heroPicks(demoSnapshot).find((p) => p.phrase.includes('\\('))
    expect(math).toBeDefined()
    expect(math!.concept.quote.includes(math!.phrase)).toBe(false)
    expect(math!.concept.quoteDisplay?.includes(math!.phrase)).toBe(true)
  })

  it('survives a re-analysis that renumbers the concept keys', () => {
    const renumbered: DemoSnapshot = {
      ...demoSnapshot,
      branches: demoSnapshot.branches.map((b) => ({ ...b, concepts: b.concepts.map((c, i) => ({ ...c, key: `${b.key}-${i}` })) })),
    }
    expect(heroPicks(renumbered).map((p) => p.concept.name)).toEqual(HERO_PICKS.map((p) => p.name))
  })

  it('drops a pick whose phrase is no longer in the quote, keeping the others in their slots', () => {
    const first = HERO_PICKS[0]
    const snap: DemoSnapshot = {
      ...demoSnapshot,
      branches: demoSnapshot.branches.map((b) => ({
        ...b,
        concepts: b.concepts.map((c) => (c.name === first.name ? { ...c, quote: 'A different sentence.', quoteDisplay: '' } : c)),
      })),
    }
    const picks = heroPicks(snap)
    expect(picks.map((p) => p.concept.name)).not.toContain(first.name)
    expect(picks.map((p) => p.index)).toEqual([1, 2, 3, 4])
    expect(heroPicks({ ...snap, branches: [] })).toEqual([])
  })

  it('uses verbatim first-page text from the snapshot', () => {
    const page = demoSnapshot.paper.firstPage
    expect(page?.introduction.length).toBeGreaterThan(500)
    expect(page?.figureCaption).toMatch(/^Figure 1: /)
    expect(demoSnapshot.paper.abstract?.length).toBeGreaterThan(200)
    expect(concepts.length).toBeGreaterThan(0)
  })
})

describe('hero geometry', () => {
  const links = HERO_SLOTS.map(heroLink)
  // A tag is about 31 units tall at full size and up to 39 when the frame is scaled down
  // and the name keeps its 10.5px floor; its drift adds its amplitude on each side.
  const half = (i: number) => 39 / 2 + Math.abs(HERO_SLOTS[i].drift.y)

  it("keeps each link's vertical run clear of every other link, so none cross", () => {
    const runs = links.map((l) => [Math.min(l.y, l.tagY), Math.max(l.y, l.tagY)] as const)
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) expect(runs[i][1] < runs[j][0] || runs[j][1] < runs[i][0], `links ${i} and ${j}`).toBe(true)
  })

  it('keeps tags apart, and no link runs through another tag', () => {
    for (let i = 0; i < links.length; i++)
      for (let j = i + 1; j < links.length; j++) expect(Math.abs(links[i].tagY - links[j].tagY), `tags ${i} and ${j}`).toBeGreaterThan(half(i) + half(j))
    for (let i = 0; i < links.length; i++) {
      for (let j = 0; j < links.length; j++) {
        if (i === j) continue
        const top = links[j].tagY - half(j)
        const bottom = links[j].tagY + half(j)
        // Every horizontal run of link i ends left of its own tag; only tags starting before that end matter.
        for (const [y, end] of [[links[i].y, links[i].elbowX], [links[i].tagY, links[i].tagX]] as const) {
          if (links[j].tagX < end) expect(y < top || y > bottom, `link ${i} at ${y} vs tag ${j}`).toBe(true)
        }
      }
    }
  })

  it('places every tag 16 to 64 units off the sheet and inside the frame', () => {
    for (const s of HERO_SLOTS) {
      expect(s.tagGap).toBeGreaterThanOrEqual(16)
      expect(s.tagGap).toBeLessThanOrEqual(64)
    }
    for (const l of links) {
      expect(l.tagY - 20).toBeGreaterThan(0)
      expect(l.tagY + 20).toBeLessThan(H)
      expect(l.tagX + 170).toBeLessThan(W)
    }
  })
})
