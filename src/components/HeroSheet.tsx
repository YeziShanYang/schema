/**
 * Landing hero illustration: the demo paper's first page, drawn in CSS and
 * SVG and set in a LaTeX-like serif, with five phrases highlighted and linked
 * to the concepts they use. Every word on it comes from the bundled snapshot:
 * the title, authors, arXiv stamp, abstract, introduction and Figure 1
 * caption, and for each pick a phrase copied verbatim from the concept's
 * quote (or its LaTeX quoteDisplay, shown with MathText) plus the concept's
 * name. The body text and the figure are blurred into texture; the
 * highlighted phrases stay sharp.
 *
 * Layout is a fixed 600 by 520 frame in `--u` units (1px at full size; see
 * .hero-art in styles.css), so the dashed links are plain SVG paths in the
 * same coordinates. A highlighted phrase ends its line, so its link starts at
 * the column's right edge whatever the phrase's width.
 *
 * Static: no data hooks, safe for the prerendered landing.
 */

import { useId, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { MathText } from './MathText'
import type { DemoConcept, DemoSnapshot } from '../data/demo'

/** STIX Two Text reads like LaTeX output. Loaded only where the sheet renders. */
const PAPER_FONT = 'https://fonts.googleapis.com/css2?family=STIX+Two+Text:ital,wght@0,400;0,600;1,400&display=swap'

/** Concepts shown, by name, each with a phrase copied from its quote. Top to bottom. */
export const HERO_PICKS: readonly { name: string; phrase: string }[] = [
  { name: 'Self-attention', phrase: 'positions of a single sequence' },
  { name: 'BLEU score', phrase: 'more than 2.0 BLEU' },
  { name: 'Multi-head attention', phrase: 'jointly attend' },
  { name: 'Softmax function', phrase: 'large values of \\(d_k\\)' },
  { name: 'Positional encoding', phrase: 'position of the tokens' },
]

// ---- Geometry, in frame units (600 x 520). Sheet coordinates are offset by SHEET_TOP.
export const W = 600
export const H = 520
const SHEET_W = 360
const SHEET_TOP = 20
const PAD = 26
const LINE = 11.5
const ABSTRACT = { left: PAD + 22, right: SHEET_W - PAD - 22, top: 113, lines: 7 }
const COL_W = 148
const LEFT_COL = { left: PAD, right: PAD + COL_W }
const RIGHT_COL = { left: SHEET_W - PAD - COL_W, right: SHEET_W - PAD }
const COLS_TOP = 206
const FIGURE = { top: COLS_TOP, height: 128 }
const LEFT_TEXT_TOP = 383
/** How far into a tag its link runs, hidden under the card, so a sideways drift never opens a gap. */
const TAG_OVERLAP = 3

/**
 * Where each pick sits, in HERO_PICKS order: its phrase's line, and its tag's
 * center height, distance from the sheet's edge and drift. Tags are placed
 * by hand; each link's vertical run stays clear of every other's, so no two
 * links cross (checked in hero-sheet.test.ts).
 */
export const HERO_SLOTS: readonly {
  at: 'abstract' | 'column'
  line: number
  tagY: number
  tagGap: number
  drift: { x: number; y: number; s: number; phase: number }
}[] = [
  { at: 'abstract', line: 1, tagY: 120, tagGap: 46, drift: { x: 1.2, y: 2.5, s: 6.2, phase: 1.3 } },
  { at: 'abstract', line: 5, tagY: 180, tagGap: 60, drift: { x: -1.5, y: 1.8, s: 7.4, phase: 4.1 } },
  { at: 'column', line: 2, tagY: 238, tagGap: 20, drift: { x: 0.8, y: -3, s: 5.6, phase: 2.2 } },
  { at: 'column', line: 9, tagY: 352, tagGap: 38, drift: { x: -1, y: 2.2, s: 6.8, phase: 0.6 } },
  { at: 'column', line: 17, tagY: 452, tagGap: 28, drift: { x: 1.6, y: -1.6, s: 7.9, phase: 3.4 } },
]

export interface HeroPick {
  concept: DemoConcept
  phrase: string
  slot: (typeof HERO_SLOTS)[number]
  index: number
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** The picks whose concept is in the snapshot (matched by name) and whose phrase is in its quote. */
export function heroPicks(snap: DemoSnapshot): HeroPick[] {
  const byName = new Map<string, DemoConcept>()
  for (const c of snap.branches.flatMap((b) => b.concepts)) if (!byName.has(norm(c.name))) byName.set(norm(c.name), c)
  return HERO_PICKS.flatMap((p, i) => {
    const concept = byName.get(norm(p.name))
    const source = concept ? concept.quoteDisplay || concept.quote : ''
    return concept && source.includes(p.phrase) ? [{ concept, phrase: p.phrase, slot: HERO_SLOTS[i], index: i }] : []
  })
}

/** A link's points: from the end of its phrase's line, out past the sheet, to its tag. */
export function heroLink(slot: (typeof HERO_SLOTS)[number]) {
  const y = SHEET_TOP + (slot.at === 'abstract' ? ABSTRACT.top : COLS_TOP) + slot.line * LINE + LINE / 2
  const x = (slot.at === 'abstract' ? ABSTRACT.right : RIGHT_COL.right) + 1
  const tagX = SHEET_W + slot.tagGap
  const elbowX = tagX - 12
  return { x, y, elbowX, tagX, tagY: slot.tagY, d: `M${x},${y} H${elbowX} V${slot.tagY} H${tagX + TAG_OVERLAP}` }
}

const u = (n: number) => `calc(var(--u) * ${n})`
const box = (left: number, top: number, width: number, height: number): CSSProperties => ({
  left: u(left),
  top: u(top),
  width: u(width),
  height: u(height),
})

/** The introduction split across the two columns: the right one starts at the first sentence after about 330 characters. */
function splitIntro(text: string): [string, string] {
  const m = /[.!?]\]?\s+(?=[A-Z])/g
  m.lastIndex = 330
  const hit = m.exec(text)
  return hit ? [text, text.slice(hit.index + hit[0].length)] : [text, '']
}

function Mark({ pick }: { pick: HeroPick }) {
  const left = pick.slot.at === 'abstract' ? ABSTRACT.left : RIGHT_COL.left
  const right = pick.slot.at === 'abstract' ? ABSTRACT.right : RIGHT_COL.right
  const top = (pick.slot.at === 'abstract' ? ABSTRACT.top : COLS_TOP) + pick.slot.line * LINE
  return (
    <span className="hero-line" style={box(left, top, right - left, LINE)}>
      <span
        className="hero-mark"
        style={{ ['--i' as string]: pick.index }}
        data-testid="hero-phrase"
        data-concept-key={pick.concept.key}
        data-phrase={pick.phrase}
      >
        <MathText text={pick.phrase} className="hero-mark-text" />
      </span>
    </span>
  )
}

export function HeroSheet({ snap, className }: { snap: DemoSnapshot; className?: string }) {
  // useId's format varies by React version; keep only characters that are safe inside url(#…).
  const id = 'hero' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const picks = heroPicks(snap)
  const page = snap.paper.firstPage
  const [introLeft, introRight] = splitIntro(page?.introduction ?? '')
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(picks.map((p) => p.concept.name))
  const label = picks.length
    ? `Illustration: the first page of ${snap.paper.title} with ${picks.length} phrases highlighted, each linked to the concept it uses: ${names}.`
    : `Illustration: the first page of ${snap.paper.title}.`
  const authors = snap.paper.authors

  return (
    <div className={cn('hero-art relative', className)} style={{ width: u(W), height: u(H) }} role="img" aria-label={label} data-testid="hero-art">
      <link rel="stylesheet" href={PAPER_FONT} precedence="default" />
      <div className="hero-sheet" lang="en" style={{ width: u(SHEET_W), height: u(H), top: u(SHEET_TOP) }}>
        {page?.stamp && <span className="hero-stamp" style={{ left: u(7), top: u(150) }}>{page.stamp}</span>}
        <i className="hero-rule" style={box(PAD, 24, SHEET_W - 2 * PAD, 2.5)} />
        <span className="hero-title" style={box(PAD, 30, SHEET_W - 2 * PAD, 22)}>{snap.paper.title}</span>
        <i className="hero-rule" style={box(PAD, 56.5, SHEET_W - 2 * PAD, 0.75)} />
        <span className="hero-authors hero-blur" style={box(PAD, 66, SHEET_W - 2 * PAD, 21)}>
          {authors.slice(0, 4).join('    ')}
          <br />
          {authors.slice(4, 8).join('    ')}
        </span>
        <span className="hero-heading" style={{ ...box(PAD, 98, SHEET_W - 2 * PAD, 12), textAlign: 'center' }}>Abstract</span>
        {snap.paper.abstract && (
          <p className="hero-body hero-blur" style={box(ABSTRACT.left, ABSTRACT.top, ABSTRACT.right - ABSTRACT.left, ABSTRACT.lines * LINE)}>
            {snap.paper.abstract}
          </p>
        )}

        {page?.figureCaption && (
          <>
            <PaperFigure style={box(LEFT_COL.left, FIGURE.top, COL_W, FIGURE.height)} />
            <span className="hero-caption" style={box(LEFT_COL.left, FIGURE.top + FIGURE.height + 4, COL_W, 20)}>{page.figureCaption}</span>
          </>
        )}
        {introLeft && (
          <>
            <span className="hero-heading" style={box(LEFT_COL.left, LEFT_TEXT_TOP - 15, COL_W, 12)}>1&ensp;Introduction</span>
            <p className="hero-body hero-blur" style={box(LEFT_COL.left, LEFT_TEXT_TOP, COL_W, H - LEFT_TEXT_TOP)}>{introLeft}</p>
          </>
        )}
        {introRight && (
          <p className="hero-body hero-blur" style={box(RIGHT_COL.left, COLS_TOP, COL_W, H - COLS_TOP)}>{introRight}</p>
        )}
        {picks.map((p) => (
          <Mark key={p.concept.key} pick={p} />
        ))}
      </div>

      <svg className="hero-links" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {picks.map((p) => {
          const link = heroLink(p.slot)
          const mask = `${id}-m${p.index}`
          return (
            <g key={p.concept.key} style={{ ['--i' as string]: p.index }}>
              <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
                <path className="hero-draw" d={link.d} pathLength={1} />
              </mask>
              <path className="hero-link" d={link.d} mask={`url(#${mask})`} />
              <circle className="hero-port" cx={link.x} cy={link.y} r={1.75} />
            </g>
          )
        })}
      </svg>

      {picks.map((p) => {
        const link = heroLink(p.slot)
        const { x, y, s, phase } = p.slot.drift
        return (
          <span
            key={p.concept.key}
            className="hero-tag"
            style={{
              left: u(link.tagX),
              top: u(link.tagY),
              ['--i' as string]: p.index,
              ['--dx' as string]: u(x),
              ['--dy' as string]: u(y),
              ['--drift' as string]: `${s}s`,
              ['--phase' as string]: `${-phase}s`,
            }}
            data-testid="hero-tag"
            data-concept-key={p.concept.key}
          >
            <span className="hero-tag-card">{p.concept.name}</span>
          </span>
        )
      })}
    </div>
  )
}

/**
 * A simplified drawing of the paper's Figure 1: the encoder and decoder
 * stacks with their sublayers, embeddings, positional encodings and output
 * layers, labeled as in the paper. Blurred on the sheet, so it reads as a
 * figure rather than as text.
 */
function PaperFigure({ style }: { style: CSSProperties }) {
  const block = (x: number, y: number, w: number, h: number, kind: 'attn' | 'ff' | 'norm' | 'embed' | 'out', text: string) => (
    <g key={`${x}-${y}`}>
      <rect className={`fig-${kind}`} x={x} y={y} width={w} height={h} rx={1} />
      <text x={x + w / 2} y={y + h / 2 + 1.4}>{text}</text>
    </g>
  )
  const arrow = (x: number, y1: number, y2: number) => <path key={`a${x}-${y1}`} className="fig-arrow" d={`M${x},${y1} V${y2 + 1.5} m-1.2,1.6 l1.2,-1.6 l1.2,1.6`} />
  return (
    <svg className="hero-figure" viewBox="0 0 148 128" style={style} aria-hidden="true">
      {/* Encoder (left) and decoder (right) stacks, each repeated N times. */}
      <rect className="fig-stack" x={12} y={50} width={52} height={42} rx={3} />
      <rect className="fig-stack" x={80} y={24} width={56} height={68} rx={3} />
      <text className="fig-n" x={6} y={72}>N×</text>
      <text className="fig-n" x={142} y={60}>N×</text>
      {block(16, 80, 44, 8, 'attn', 'Multi-Head Attention')}
      {block(16, 70, 44, 6, 'norm', 'Add & Norm')}
      {block(16, 60, 44, 7, 'ff', 'Feed Forward')}
      {block(16, 53, 44, 5, 'norm', 'Add & Norm')}
      {block(84, 82, 48, 8, 'attn', 'Masked Multi-Head Attention')}
      {block(84, 73, 48, 5, 'norm', 'Add & Norm')}
      {block(84, 61, 48, 8, 'attn', 'Multi-Head Attention')}
      {block(84, 52, 48, 5, 'norm', 'Add & Norm')}
      {block(84, 41, 48, 7, 'ff', 'Feed Forward')}
      {block(84, 32, 48, 5, 'norm', 'Add & Norm')}
      {block(88, 13, 40, 6, 'out', 'Linear')}
      {block(88, 4, 40, 6, 'out', 'Softmax')}
      {block(16, 106, 44, 7, 'embed', 'Input Embedding')}
      {block(84, 106, 48, 7, 'embed', 'Output Embedding')}
      <circle className="fig-sum" cx={38} cy={98} r={2.6} />
      <circle className="fig-sum" cx={108} cy={98} r={2.6} />
      <path className="fig-wave" d="M2,98 q2,-4 4,0 t4,0 t4,0" />
      <path className="fig-wave" d="M134,98 q2,-4 4,0 t4,0 t4,0" />
      {[arrow(38, 106, 100.6), arrow(38, 95.4, 88), arrow(38, 80, 76), arrow(38, 70, 67), arrow(38, 60, 58)]}
      {[arrow(108, 106, 100.6), arrow(108, 95.4, 90), arrow(108, 82, 78), arrow(108, 73, 69), arrow(108, 61, 57), arrow(108, 52, 48), arrow(108, 41, 37), arrow(108, 32, 19), arrow(108, 13, 10)]}
      <path className="fig-arrow" d="M38,53 V46 H76 V65 H84" />
      <text x={38} y={124}>Inputs</text>
      <text x={108} y={124}>Outputs (shifted right)</text>
    </svg>
  )
}
