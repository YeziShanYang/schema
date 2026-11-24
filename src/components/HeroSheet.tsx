/**
 * Landing hero illustration: the first page of the demo paper, drawn in CSS
 * and SVG, with a few phrases highlighted and linked to the concepts they
 * use. Every word on it comes from the bundled snapshot: the title, authors
 * and arXiv id, a section heading, and for each pick a phrase taken verbatim
 * from the concept's quote (or its LaTeX quoteDisplay, shown with MathText)
 * plus the concept's name.
 *
 * Layout is a fixed 480 by 420 frame in `--u` units (1px at full size; see
 * .hero-art in styles.css), so the dashed links can be plain SVG paths in
 * the same coordinates. Highlighted phrases sit at the end of their row, so a
 * link always starts at the row's right edge, whatever the phrase's width.
 *
 * Static: no data hooks, safe for the prerendered landing.
 */

import { useId, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { MathText } from './MathText'
import type { DemoConcept, DemoSnapshot } from '../data/demo'

/** Concepts shown, with a phrase copied from each one's quote, top to bottom. */
export const HERO_PICKS: readonly { key: string; phrase: string; at: 'abstract' | 'column'; row: number }[] = [
  { key: 'c4', phrase: 'positions of a single sequence', at: 'abstract', row: 1 },
  { key: 'c16', phrase: 'more than 2.0 BLEU', at: 'abstract', row: 5 },
  { key: 'c7', phrase: 'jointly attend', at: 'column', row: 2 },
  { key: 'c6', phrase: 'large values of \\(d_k\\)', at: 'column', row: 6 },
  { key: 'c10', phrase: 'position of the tokens', at: 'column', row: 10 },
]

export interface HeroPick {
  concept: DemoConcept
  phrase: string
  at: 'abstract' | 'column'
  row: number
}

/** The picks whose concept is in the snapshot and whose phrase is in its quote. */
export function heroPicks(snap: DemoSnapshot): HeroPick[] {
  const concepts = new Map(snap.branches.flatMap((b) => b.concepts).map((c) => [c.key, c]))
  return HERO_PICKS.flatMap((p) => {
    const concept = concepts.get(p.key)
    const source = concept ? concept.quoteDisplay || concept.quote : ''
    return concept && source.includes(p.phrase) ? [{ ...p, concept }] : []
  })
}

// ---- Geometry, in frame units (480 x 420). The sheet's own coordinates are offset by SHEET_TOP.
const W = 480
const H = 420
const SHEET_W = 300
const SHEET_TOP = 24
const PAD = 22
const ROW = 14
const ABSTRACT = { left: PAD + 20, right: SHEET_W - PAD - 20, top: 96 }
const COL_GAP = 14
const COL_W = (SHEET_W - 2 * PAD - COL_GAP) / 2
const COLS_TOP = 194
const LEFT_COL = { left: PAD, right: PAD + COL_W }
const RIGHT_COL = { left: PAD + COL_W + COL_GAP, right: SHEET_W - PAD }
const ELBOW_X = 306
const TAG_X = 318
/** How far above its phrase each tag's center sits. */
const TAG_RISE = 18

/** Row widths as fractions; a short row ends a paragraph. Repeats as needed. */
const ABSTRACT_ROWS = [1, 1, 1, 1, 1, 0.62]
const COLUMN_ROWS = [1, 1, 1, 1, 1, 0.55, 1, 1, 1, 1, 1, 1, 0.7, 1, 1, 1]

const u = (n: number) => `calc(var(--u) * ${n})`

function phraseY(p: { at: 'abstract' | 'column'; row: number }) {
  const top = p.at === 'abstract' ? ABSTRACT.top : COLS_TOP
  return SHEET_TOP + top + p.row * ROW + ROW / 2
}
function phraseRight(p: { at: 'abstract' | 'column' }) {
  return p.at === 'abstract' ? ABSTRACT.right : RIGHT_COL.right
}

function Rows({ left, right, top, widths, count, picks, firstIndex }: {
  left: number
  right: number
  top: number
  widths: number[]
  count: number
  picks: (HeroPick & { index: number })[]
  firstIndex?: number
}) {
  const width = right - left
  return (
    <>
      {Array.from({ length: count }, (_, r) => {
        const pick = picks.find((p) => p.row === r)
        const frac = widths[(r + (firstIndex ?? 0)) % widths.length]
        const style: CSSProperties = { left: u(left), top: u(top + r * ROW), width: u(pick ? width : width * frac), height: u(ROW) }
        if (!pick) return <span key={r} className="hero-row" style={style}><i className="hero-bar" /></span>
        return (
          <span key={r} className="hero-row" style={style}>
            <i className="hero-bar" />
            <span
              className="hero-mark"
              style={{ ['--i' as string]: pick.index }}
              data-testid="hero-phrase"
              data-concept-key={pick.concept.key}
              data-phrase={pick.phrase}
            >
              <MathText text={pick.phrase} />
            </span>
          </span>
        )
      })}
    </>
  )
}

export function HeroSheet({ snap, className }: { snap: DemoSnapshot; className?: string }) {
  // useId's format varies by React version; keep only characters that are safe inside url(#…).
  const id = 'hero' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const picks = heroPicks(snap).map((p, index) => ({ ...p, index }))
  const intro = snap.branches.flatMap((b) => b.concepts).find((c) => /^1\s/.test(c.section))?.section
  const authors = snap.paper.authors
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(picks.map((p) => p.concept.name))
  const label = picks.length
    ? `Illustration: the first page of ${snap.paper.title} with ${picks.length} phrases highlighted, each linked to the concept it uses: ${names}.`
    : `Illustration: the first page of ${snap.paper.title}.`

  return (
    <div
      className={cn('hero-art relative', className)}
      style={{ width: u(W), height: u(H) }}
      role="img"
      aria-label={label}
      data-testid="hero-art"
    >
      <div className="hero-sheet" style={{ width: u(SHEET_W), height: u(H), top: u(SHEET_TOP) }}>
        <span className="hero-stamp" style={{ left: u(7), top: u(232) }}>arXiv:{snap.paper.arxivId}</span>
        <span className="hero-title" style={{ top: u(18), left: u(PAD), right: u(PAD) }}>{snap.paper.title}</span>
        <span className="hero-authors" style={{ top: u(44), left: u(PAD), right: u(PAD) }}>
          {authors.slice(0, 4).join('   ')}
          <br />
          {authors.slice(4, 8).join('   ')}
        </span>
        <span className="hero-heading" style={{ top: u(80), left: u(PAD), right: u(PAD), textAlign: 'center' }}>Abstract</span>
        <Rows left={ABSTRACT.left} right={ABSTRACT.right} top={ABSTRACT.top} widths={ABSTRACT_ROWS} count={6} picks={picks.filter((p) => p.at === 'abstract')} />
        {intro && <span className="hero-heading" style={{ top: u(COLS_TOP), left: u(LEFT_COL.left) }}>{intro}</span>}
        <Rows left={LEFT_COL.left} right={LEFT_COL.right} top={intro ? COLS_TOP + ROW + 2 : COLS_TOP} widths={COLUMN_ROWS} count={15} picks={[]} firstIndex={3} />
        <Rows left={RIGHT_COL.left} right={RIGHT_COL.right} top={COLS_TOP} widths={COLUMN_ROWS} count={16} picks={picks.filter((p) => p.at === 'column')} />
      </div>

      <svg className="hero-links" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {picks.map((p) => {
          const y = phraseY(p)
          const x = phraseRight(p) + 1
          const d = `M${x},${y} H${ELBOW_X} V${y - TAG_RISE} H${TAG_X}`
          const mask = `${id}-m${p.index}`
          return (
            <g key={p.concept.key} style={{ ['--i' as string]: p.index }}>
              <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
                <path className="hero-draw" d={d} pathLength={1} />
              </mask>
              <path className="hero-link" d={d} mask={`url(#${mask})`} />
              <circle className="hero-port" cx={x} cy={y} r={1.75} />
            </g>
          )
        })}
      </svg>

      {picks.map((p) => (
        <span
          key={p.concept.key}
          className="hero-tag"
          style={{ left: u(TAG_X), top: u(phraseY(p) - TAG_RISE), ['--i' as string]: p.index, ['--drift' as string]: `${5.4 + (p.index % 3) * 0.8}s` }}
          data-testid="hero-tag"
          data-concept-key={p.concept.key}
        >
          <span className="hero-tag-card">{p.concept.name}</span>
        </span>
      ))}
    </div>
  )
}
