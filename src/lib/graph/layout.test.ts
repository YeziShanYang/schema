import { describe, expect, it } from 'vitest'
import { CLEAR, EDGE, graphLayout, type Size } from './layout'

function boxes(layout: ReturnType<typeof graphLayout>, nodes: Size[], scale = 1) {
  return layout.points.map((p, i) => ({
    top: p.y - (nodes[i].h * scale) / 2,
    bottom: p.y + (nodes[i].h * scale) / 2,
    left: p.x - (nodes[i].w * scale) / 2,
    right: p.x + (nodes[i].w * scale) / 2,
  }))
}

function overlaps(a: { top: number; bottom: number; left: number; right: number }, b: typeof a) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

const center: Size = { w: 410, h: 105 }

describe('graphLayout', () => {
  it('keeps a tall recommendation below the center inside the canvas', () => {
    // A workspace with one paper and three recommendations, one with a six-line reason.
    const nodes: Size[] = [{ w: 310, h: 165 }, { w: 310, h: 255 }, { w: 310, h: 260 }, { w: 310, h: 225 }]
    const w = 1240
    const h = 712
    const layout = graphLayout({ w, h, scale: 1, center, nodes })
    const c = { top: layout.cy - center.h / 2, bottom: layout.cy + center.h / 2, left: w / 2 - center.w / 2, right: w / 2 + center.w / 2 }
    for (const b of boxes(layout, nodes)) {
      expect(b.top).toBeGreaterThanOrEqual(EDGE - 0.5)
      expect(b.bottom).toBeLessThanOrEqual(h - EDGE + 0.5)
      expect(b.left).toBeGreaterThanOrEqual(EDGE - 0.5)
      expect(b.right).toBeLessThanOrEqual(w - EDGE + 0.5)
      expect(overlaps(b, c)).toBe(false)
    }
    expect(layout.minHeight).toBeLessThanOrEqual(h)
  })

  it('asks for a taller canvas when the cards cannot fit without covering the center', () => {
    const nodes: Size[] = [{ w: 310, h: 420 }, { w: 310, h: 200 }, { w: 310, h: 420 }]
    const layout = graphLayout({ w: 1240, h: 600, scale: 1, center, nodes })
    expect(layout.minHeight).toBeGreaterThan(600)
    // At that height everything fits and nothing covers the center card.
    const h = layout.minHeight
    const grown = graphLayout({ w: 1240, h, scale: 1, center, nodes })
    const c = { top: grown.cy - center.h / 2, bottom: grown.cy + center.h / 2, left: 620 - center.w / 2, right: 620 + center.w / 2 }
    for (const b of boxes(grown, nodes)) {
      expect(b.top).toBeGreaterThanOrEqual(EDGE - 0.5)
      expect(b.bottom).toBeLessThanOrEqual(h - EDGE + 0.5)
      expect(overlaps(b, { ...c, top: c.top - CLEAR + 1, bottom: c.bottom + CLEAR - 1 })).toBe(false)
    }
    expect(grown.minHeight).toBe(layout.minHeight)
  })

  it('keeps the old spacing when small cards fit', () => {
    const nodes: Size[] = Array.from({ length: 5 }, () => ({ w: 190, h: 90 }))
    const layout = graphLayout({ w: 1240, h: 760, scale: 1, center, nodes })
    // The preferred vertical radius is min(0.36 h, 260) = 260 here, so the top card sits that far up, scaled by its angle.
    const top = layout.points[0]
    expect(top.y - layout.cy).toBeCloseTo(Math.sin(-Math.PI / 2 + 0.35) * 260, 5)
    expect(layout.minHeight).toBeLessThan(760)
  })

  it('moves the center up when the card below needs more room than the one above', () => {
    // Two recommendations: a short one above the center and a tall one below.
    const nodes: Size[] = [{ w: 228, h: 163 }, { w: 228, h: 291 }]
    const small = { w: 300, h: 133 }
    const h = 773
    const layout = graphLayout({ w: 1208, h, scale: 1, center: small, nodes })
    expect(layout.minHeight).toBeLessThanOrEqual(h)
    expect(layout.cy).toBeLessThan(h / 2)
    const c = { top: layout.cy - small.h / 2, bottom: layout.cy + small.h / 2, left: 604 - small.w / 2, right: 604 + small.w / 2 }
    for (const b of boxes(layout, nodes)) {
      expect(b.top).toBeGreaterThanOrEqual(EDGE - 0.5)
      expect(b.bottom).toBeLessThanOrEqual(h - EDGE + 0.5)
      expect(overlaps(b, c)).toBe(false)
    }
  })

  it('treats unmeasured cards as points', () => {
    const layout = graphLayout({ w: 1000, h: 600, scale: 0.9, center: { w: 0, h: 0 }, nodes: [{ w: 0, h: 0 }, { w: 0, h: 0 }] })
    expect(layout.points).toHaveLength(2)
    for (const p of layout.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })
})
