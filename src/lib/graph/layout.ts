/**
 * Where FloatingGraph puts its cards: the center card near the middle of the
 * canvas and the other cards on an ellipse around it, starting near the top
 * and going clockwise.
 *
 * Card sizes are measured, so a tall card (a recommendation with a long
 * reason) stays inside the canvas. The ellipse flattens to fit, but never so
 * far that a card above or below the center card covers it, and the center
 * moves up or down when the cards on one side need more room than the other.
 * When even that doesn't fit, `minHeight` is the canvas height that does, and
 * the graph grows to it so the page scrolls instead of cutting a card off.
 * Sizes are the cards' unscaled layout sizes; `scale` is applied here. A card
 * not measured yet has size 0.
 */

export interface Size {
  w: number
  h: number
}

export interface GraphLayout {
  cx: number
  cy: number
  /** Center of each card, in the order given. */
  points: { x: number; y: number }[]
  /** The smallest canvas height at which no card leaves the canvas or covers the center card. */
  minHeight: number
}

/** Space kept between a card and the canvas edge, including the cards' slow drift. */
export const EDGE = 24
/** Space kept between a card and the center card. */
export const CLEAR = 16

export function nodeAngle(i: number, n: number): number {
  return -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + 0.35
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v))
}

export function graphLayout(args: { w: number; h: number; scale: number; center: Size; nodes: Size[] }): GraphLayout {
  const { w, h, scale, center, nodes } = args
  const cx = w / 2
  const rx = Math.max(Math.min(w * 0.36, 440), 290 * scale)
  const preferredRy = Math.max(Math.min(h * 0.36, 260), 150)
  const centerHalfW = (center.w * scale) / 2
  const centerHalfH = (center.h * scale) / 2

  const cards = nodes.map((size, i) => {
    const a = nodeAngle(i, nodes.length)
    const halfW = (size.w * scale) / 2
    const halfH = (size.h * scale) / 2
    const x = clamp(cx + Math.cos(a) * rx, halfW + EDGE, w - halfW - EDGE)
    return { sin: Math.sin(a), halfW, halfH, x }
  })

  // A card in line with the center card has to clear it vertically.
  let ryMin = 0
  for (const c of cards) {
    const s = Math.abs(c.sin)
    if (s > 1e-6 && Math.abs(c.x - cx) < centerHalfW + c.halfW + CLEAR) ryMin = Math.max(ryMin, (centerHalfH + c.halfH + CLEAR) / s)
  }

  // How far the graph reaches above and below the center card's middle, for a vertical radius ry.
  const reach = (ry: number) => {
    let up = centerHalfH + EDGE
    let down = centerHalfH + EDGE
    for (const c of cards) {
      up = Math.max(up, -c.sin * ry + c.halfH + EDGE)
      down = Math.max(down, c.sin * ry + c.halfH + EDGE)
    }
    return { up, down }
  }
  const fits = (ry: number) => {
    const r = reach(ry)
    return r.up + r.down <= h
  }

  // The preferred radius when it fits, else the largest that does, but never below ryMin.
  let ry = Math.max(ryMin, preferredRy)
  if (!fits(ry) && fits(ryMin)) {
    let lo = ryMin
    let hi = ry
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    ry = lo
  } else if (!fits(ry)) {
    ry = ryMin
  }

  const r = reach(ry)
  // Spare height is split evenly above and below.
  const cy = h >= r.up + r.down ? r.up + (h - r.up - r.down) / 2 : h / 2
  const need = reach(ryMin)
  const minHeight = Math.ceil(need.up + need.down)

  const points = cards.map((c) => ({ x: c.x, y: clamp(cy + c.sin * ry, c.halfH + EDGE, h - c.halfH - EDGE) }))
  return { cx, cy, points, minHeight }
}
