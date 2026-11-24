/**
 * The paper overview window: "In plain words" at the top, the paper's story
 * as a numbered column of plain sentences (each with a "More technical"
 * line), and the concepts each sentence relies on as chips on both sides,
 * joined to their sentences by dashed elbow lines. Hovering or focusing a
 * sentence lights up its chips and lines, and the other way round; clicking
 * a chip opens that concept in its branch. Below 900px there are no lines and
 * each sentence lists its chips underneath. Concepts no sentence uses sit in
 * an "Also needed" row. It is a BranchPanel, so it enters, exits, traps focus
 * and closes on Esc like the branch panel. The lines draw once on open
 * (400ms) and appear without drawing under reduced motion.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import { Button, Checkbox, Label } from '@/components/ui'
import { BranchPanel } from '../graph/BranchPanel'
import { ConceptName, MathText } from '../MathText'
import type { PaperOverview } from '../../types'

export interface OverviewConcept {
  key: string
  name: string
  known: boolean
}

/** The sentence or chip under a mouse pointer or keyboard focus. Touch skips hover, so a tap never leaves a highlight stuck on. */
type Hot = { kind: 'item'; id: string } | { kind: 'chip'; key: string } | null

interface ChipPos {
  key: string
  side: 'left' | 'right'
  top: number
  h: number
}

interface Line {
  id: string
  key: string
  item: string
  d: string
}

interface Layout {
  chips: ChipPos[]
  lines: Line[]
  height: number
  width: number
}

const WIDE = '(min-width: 900px)'
/** Vertical space between stacked chips in a side column. */
const GAP = 8

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * Places each chip beside the sentences that use it, on whichever side lets
 * it sit closest to them, then routes one elbow line per chip and sentence.
 * Each chip's vertical run gets its own x in the gutter so runs never overlap.
 */
function computeLayout(
  map: HTMLElement,
  story: HTMLElement,
  left: HTMLElement,
  right: HTMLElement,
  items: { id: string; el: HTMLElement | null; keys: string[] }[],
  used: string[],
  chipHeight: (key: string) => number,
): Layout | null {
  const box = map.getBoundingClientRect()
  const storyBox = story.getBoundingClientRect()
  const centers = new Map<string, number>()
  for (const it of items) {
    if (!it.el) return null
    const r = it.el.getBoundingClientRect()
    // Anchor at the first line of the sentence rather than the middle of a tall card.
    centers.set(it.id, r.top - box.top + Math.min(r.height / 2, 21))
  }
  const targets = used
    .map((key) => {
      const ys = items.filter((it) => it.keys.includes(key)).map((it) => centers.get(it.id) ?? 0)
      return { key, h: chipHeight(key), target: ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length) }
    })
    .sort((a, b) => a.target - b.target)
  const bottom = { left: -Infinity, right: -Infinity }
  const count = { left: 0, right: 0 }
  const chips: ChipPos[] = []
  for (const t of targets) {
    const want = Math.max(0, t.target - t.h / 2)
    const at = (side: 'left' | 'right') => Math.max(want, bottom[side] + GAP)
    const l = at('left')
    const r = at('right')
    const side: 'left' | 'right' = l < r ? 'left' : r < l ? 'right' : count.left <= count.right ? 'left' : 'right'
    const top = side === 'left' ? l : r
    bottom[side] = top + t.h
    count[side]++
    chips.push({ key: t.key, side, top: Math.round(top), h: t.h })
  }
  const edge = {
    left: { chip: left.getBoundingClientRect().right - box.left, story: storyBox.left - box.left },
    right: { chip: right.getBoundingClientRect().left - box.left, story: storyBox.right - box.left },
  }
  const perSide = { left: chips.filter((c) => c.side === 'left'), right: chips.filter((c) => c.side === 'right') }
  const lines: Line[] = []
  for (const c of chips) {
    const list = perSide[c.side]
    const rank = list.indexOf(c)
    // Spread the vertical runs across the middle of the gutter, nearest chip closest to the story.
    const f = list.length > 1 ? 0.2 + (0.6 * rank) / (list.length - 1) : 0.5
    const x1 = edge[c.side].chip
    const x2 = edge[c.side].story
    const mx = Math.round(x1 + (x2 - x1) * (c.side === 'left' ? f : 1 - f)) + 0.5
    const y1 = Math.round(c.top + c.h / 2) + 0.5
    for (const it of items) {
      if (!it.keys.includes(c.key)) continue
      const y2 = Math.round(centers.get(it.id) ?? y1) + 0.5
      lines.push({ id: `${c.key}:${it.id}`, key: c.key, item: it.id, d: `M${x1} ${y1} H${mx} V${y2} H${x2}` })
    }
  }
  const height = Math.ceil(Math.max(storyBox.height, ...chips.map((c) => c.top + c.h)))
  return { chips, lines, height, width: Math.round(box.width) }
}

export function OverviewWindow({
  open,
  onClose,
  returnFocus,
  paperTitle,
  overview,
  concepts,
  focusKey,
  read,
  onReadChange,
  nextUpName,
  onStart,
  onOpenConcept,
}: {
  open: boolean
  onClose: () => void
  returnFocus?: () => HTMLElement | null
  paperTitle: string
  overview: PaperOverview
  /** Every concept of the paper, in sequence order. */
  concepts: Map<string, OverviewConcept>
  /** A concept to highlight when the window opens ("See in overview"). */
  focusKey?: string
  read: boolean
  onReadChange: (read: boolean) => void
  nextUpName: string | null
  onStart: () => void
  onOpenConcept: (key: string) => void
}) {
  const wide = useWide()
  const maskId = `overview-mask-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const [hot, setHot] = useState<Hot>(null)
  const [technical, setTechnical] = useState<Set<string>>(() => new Set())
  // The panel mounts its content a render after `open` turns true, so the map is tracked as state and measuring starts once it exists.
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null)
  const storyRef = useRef<HTMLOListElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLLIElement | null>())
  const chipRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [layout, setLayout] = useState<Layout | null>(null)

  // A fresh open starts unhighlighted, and its lines draw again.
  useEffect(() => {
    if (!open) {
      setHot(null)
      setLayout(null)
    }
  }, [open])

  const story = overview.story
  const items = useMemo(() => story.map((s) => ({ ...s, conceptKeys: s.conceptKeys.filter((k) => concepts.has(k)) })), [story, concepts])
  // Concepts the story uses, in the order they first appear.
  const used = useMemo(() => {
    const out: string[] = []
    for (const s of items) for (const k of s.conceptKeys) if (!out.includes(k)) out.push(k)
    return out
  }, [items])
  // Everything else, including concepts added after the overview was written.
  const alsoNeeded = useMemo(() => [...concepts.keys()].filter((k) => !used.includes(k)), [concepts, used])

  const active: Hot = hot ?? (focusKey && concepts.has(focusKey) ? { kind: 'chip', key: focusKey } : null)
  const hotKeys = useMemo(() => {
    if (!active) return new Set<string>()
    if (active.kind === 'chip') return new Set([active.key])
    return new Set(items.find((s) => s.id === active.id)?.conceptKeys ?? [])
  }, [active, items])
  const hotItems = useMemo(() => {
    if (!active) return new Set<string>()
    if (active.kind === 'item') return new Set([active.id])
    return new Set(items.filter((s) => s.conceptKeys.includes(active.key)).map((s) => s.id))
  }, [active, items])

  const measure = useCallback(() => {
    const [map, list, left, right] = [mapEl, storyRef.current, leftRef.current, rightRef.current]
    if (!map || !list || !left || !right) return
    const next = computeLayout(
      map,
      list,
      left,
      right,
      items.map((s) => ({ id: s.id, el: itemRefs.current.get(s.id) ?? null, keys: s.conceptKeys })),
      used,
      (key) => chipRefs.current.get(key)?.offsetHeight ?? 32,
    )
    if (!next) return
    setLayout((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [items, used, mapEl])

  useLayoutEffect(() => {
    if (!open || !wide) return
    measure()
    const ro = new ResizeObserver(() => measure())
    if (mapEl) ro.observe(mapEl)
    if (storyRef.current) ro.observe(storyRef.current)
    return () => ro.disconnect()
  }, [open, wide, measure, technical])

  // Bring the highlighted concept's chip into view once the window has entered.
  useEffect(() => {
    if (!open || !focusKey) return
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="overview-window"] [data-testid="overview-chip"][data-concept-key="${CSS.escape(focusKey)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }, 320)
    return () => clearTimeout(t)
  }, [open, focusKey])

  const chip = (key: string, extra?: string) => {
    const c = concepts.get(key)
    if (!c) return null
    const isHot = hotKeys.has(key)
    return (
      <button
        key={key}
        ref={(el) => {
          chipRefs.current.set(key, el)
        }}
        type="button"
        onClick={() => onOpenConcept(key)}
        onPointerEnter={(e) => e.pointerType !== 'touch' && setHot({ kind: 'chip', key })}
        onPointerLeave={(e) => e.pointerType !== 'touch' && setHot(null)}
        onFocus={() => setHot({ kind: 'chip', key })}
        onBlur={() => setHot(null)}
        data-testid="overview-chip"
        data-concept-key={key}
        data-status={c.known ? 'known' : 'unknown'}
        data-hot={isHot ? 'true' : undefined}
        aria-label={`${c.name}, ${c.known ? 'known' : 'not known yet'}. Open it in its branch`}
        title={c.name}
        className={cn(
          'overview-chip press flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-left text-[13px] leading-snug',
          c.known ? 'known-outline' : isHot ? 'border-primary bg-accent-soft' : 'border-border bg-card',
          isHot && 'text-primary',
          extra,
        )}
      >
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', c.known ? 'bg-known' : 'border-[1.5px] border-faint bg-card')}
        />
        <ConceptName name={c.name} className="line-clamp-2 min-w-0" />
      </button>
    )
  }

  const placed = new Map(layout?.chips.map((c) => [c.key, c]) ?? [])
  const sideColumn = (side: 'left' | 'right', ref: RefObject<HTMLDivElement | null>) => (
    <div ref={ref} className="relative" data-testid={`overview-chips-${side}`}>
      {used.map((k) => {
        const pos = placed.get(k)
        // Before the first layout every chip sits hidden in the left column, so its height can be measured.
        if (pos ? pos.side !== side : side === 'right') return null
        return (
          <div key={k} className={cn('absolute inset-x-0', !pos && 'invisible')} style={{ top: pos?.top ?? 0 }}>
            {chip(k, 'w-full')}
          </div>
        )
      })}
    </div>
  )
  // Hot lines are drawn last so they sit on top.
  const lines = layout ? [...layout.lines].sort((a, b) => Number(hotKeys.has(a.key) && hotItems.has(a.item)) - Number(hotKeys.has(b.key) && hotItems.has(b.item))) : []

  return (
    <BranchPanel
      open={open}
      onClose={onClose}
      returnFocus={returnFocus}
      title="Overview"
      eyebrow={paperTitle}
      testId="overview-window"
      closeLabel="Close overview"
      maxWidth={1120}
    >
      <section aria-labelledby="overview-plain-label">
        <h3 id="overview-plain-label" className="label">In plain words</h3>
        <p className="mt-1.5 max-w-[68ch] text-[15px] leading-relaxed text-pretty" data-testid="overview-plain">{overview.plain}</p>
      </section>

      <section className="mt-6" aria-labelledby="overview-story-label">
        <h3 id="overview-story-label" className="label">The paper's story</h3>
        <div
          ref={setMapEl}
          className={cn(
            'relative mt-2.5',
            wide && 'grid grid-cols-[168px_minmax(0,1fr)_168px] gap-x-10 min-[1200px]:grid-cols-[196px_minmax(0,1fr)_196px] min-[1200px]:gap-x-14',
          )}
          style={wide && layout ? { minHeight: layout.height } : undefined}
          data-testid="overview-map"
          data-layout={wide ? 'lines' : 'stacked'}
        >
          {wide && sideColumn('left', leftRef)}

          <ol ref={storyRef} className="grid content-start gap-2" data-testid="overview-story">
            {items.map((s, i) => {
              const isHot = hotItems.has(s.id)
              const showTech = technical.has(s.id)
              const names = s.conceptKeys.map((k) => concepts.get(k)?.name).filter(Boolean)
              return (
                <li
                  key={s.id}
                  ref={(el) => {
                    itemRefs.current.set(s.id, el)
                  }}
                  onPointerEnter={(e) => e.pointerType !== 'touch' && setHot({ kind: 'item', id: s.id })}
                  onPointerLeave={(e) => e.pointerType !== 'touch' && setHot(null)}
                  onFocusCapture={() => setHot({ kind: 'item', id: s.id })}
                  onBlurCapture={() => setHot(null)}
                  data-testid="overview-step"
                  data-item-id={s.id}
                  data-hot={isHot ? 'true' : undefined}
                  className={cn(
                    'rounded-lg border px-3.5 py-2.5 transition-[background-color,border-color] duration-150 ease-out',
                    isHot ? 'border-primary bg-accent-soft' : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-px grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[11px] leading-none tabular-nums transition-[background-color,border-color,color] duration-150 ease-out',
                        isHot ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-muted-foreground',
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] leading-snug text-pretty">{s.text}</p>
                      {names.length > 0 && <span className="sr-only">Uses: {names.join(', ')}.</span>}
                      {s.technical && (
                        <button
                          type="button"
                          aria-expanded={showTech}
                          onClick={() =>
                            setTechnical((t) => {
                              const n = new Set(t)
                              if (n.has(s.id)) n.delete(s.id)
                              else n.add(s.id)
                              return n
                            })
                          }
                          className="press -ml-1 mt-1 cursor-pointer rounded px-1 py-0.5 text-xs font-medium text-primary hover:bg-card"
                          data-testid="overview-technical-toggle"
                        >
                          {showTech ? 'Less technical' : 'More technical'}
                        </button>
                      )}
                      {showTech && (
                        <p className="reveal mt-1 text-[13px] leading-[1.45] text-muted-foreground" data-testid="overview-technical">
                          <MathText text={s.technical} />
                        </p>
                      )}
                      {!wide && s.conceptKeys.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">{s.conceptKeys.map((k) => chip(k))}</div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {wide && sideColumn('right', rightRef)}

          {wide && layout && (
            <svg
              className="overview-links pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              data-active={active ? 'true' : undefined}
              data-testid="overview-lines"
              aria-hidden="true"
            >
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="-8" y="-8" width={layout.width + 16} height={layout.height + 16}>
                  {layout.lines.map((l) => (
                    <path key={l.id} className="draw" d={l.d} pathLength={1} />
                  ))}
                </mask>
              </defs>
              <g mask={`url(#${maskId})`}>
                {lines.map((l) => (
                  <path key={l.id} className={cn('line', hotKeys.has(l.key) && hotItems.has(l.item) && 'hot')} d={l.d} data-line={l.id} />
                ))}
              </g>
            </svg>
          )}
        </div>
      </section>

      {alsoNeeded.length > 0 && (
        <section className="mt-6" aria-labelledby="overview-also-label">
          <h3 id="overview-also-label" className="label">Also needed</h3>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="overview-also">{alsoNeeded.map((k) => chip(k))}</div>
        </section>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Checkbox id="overview-read" checked={read} onCheckedChange={(v) => onReadChange(!!v)} data-testid="overview-read" />
          <Label htmlFor="overview-read" className="cursor-pointer">I've read the overview</Label>
        </div>
        <Button onClick={onStart} data-testid="overview-start" className="max-w-full">
          {nextUpName ? (
            <span className="truncate">
              Start: <ConceptName name={nextUpName} />
            </span>
          ) : (
            'Close'
          )}
        </Button>
      </div>
    </BranchPanel>
  )
}
