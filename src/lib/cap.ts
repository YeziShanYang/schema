/**
 * Daily cap on new paper analyses: at most DAILY_PAPER_CAP papers per user in
 * any rolling 24-hour window. Papers already analyzed by anyone are free and
 * never count.
 */

export const DAILY_PAPER_CAP = 5
export const CAP_WINDOW_MS = 24 * 60 * 60 * 1000

export function toMs(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

export interface CapState {
  used: number
  remaining: number
  allowed: boolean
  /** When the oldest counted request leaves the window (ms epoch), or 0. */
  nextSlotAt: number
}

export function capState(createdAts: unknown[], now: number, cap = DAILY_PAPER_CAP, windowMs = CAP_WINDOW_MS): CapState {
  const inWindow = createdAts
    .map(toMs)
    .filter((t) => t > 0 && now - t < windowMs)
    .sort((a, b) => a - b)
  const used = inWindow.length
  return {
    used,
    remaining: Math.max(0, cap - used),
    allowed: used < cap,
    nextSlotAt: used >= cap ? inWindow[used - cap] + windowMs : 0,
  }
}
