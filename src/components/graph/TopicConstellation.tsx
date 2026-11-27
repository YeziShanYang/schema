/**
 * The Library's topic constellation. Papers are cards, every topic that two
 * or more of them share is a small node linked to each paper that uses it,
 * and each paper's own topics are dots on two rings around its card. Green
 * marks what the reader has checked. The data comes from lib/library-network.
 *
 * A d3-force simulation places the nodes. It runs to rest before the first
 * paint, so the web never shows its settling, and the finished picture fades
 * in. When the network or the canvas size changes, the web is settled again
 * at once and each node glides from where it was drawn to its new place
 * (GLIDE_MS, ease-out). One requestAnimationFrame loop writes positions
 * straight to the DOM, so React renders the SVG and the cards once per data
 * or selection change and never per frame. Cards drift a few pixels on slow
 * sine offsets and the rings turn in opposite directions. A drag past 4px
 * moves a card, the web follows it live, and on release the card springs
 * back into the web. Every card, dot and topic stays inside the canvas.
 *
 * Hovering or focusing a card or topic highlights what it connects to.
 * Clicking a card (or Space or Enter on it) toggles its selection, and a
 * selected card shows an Open link to its paper. One selected card keeps the
 * hover emphasis. Two or more emphasize the topics that link at least two of
 * them, with a second ring on the topics all of them use. The panel under the
 * canvas names the selection and those topics, and its Add to workspace
 * (PlacementControl in add mode) adds every selected paper to a workspace,
 * or to a new one, and saves them. Clear, Esc or a click on empty canvas
 * clears the selection. A drag never selects.
 *
 * Under prefers-reduced-motion the picture holds still: no drift, no turning
 * rings, no glide (a new layout replaces the old one at once), and a dragged
 * card returns to its place on release.
 *
 * This module is lazy-loaded by the Library page, so d3-force is only
 * downloaded by readers who open the constellation.
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { ForceCollide, ForceX, ForceY, Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { arxivSlug } from '@/lib/arxiv'
import { constellationHeight, keepShown, networkShape, selectionConnections, sharedWith, type Connection, type LibraryNetwork } from '@/lib/library-network'
import { cn, plural } from '@/lib/utils'
import { ArrowRightIcon } from '../icons'
import { PlacementControl } from '../PlacementControl'

export interface ConstellationPaper {
  /** The paper's record id. */
  id: string
  arxivId: string
  title: string
  topicKeys: readonly string[]
  /** Checked concepts, as the list counts them. */
  known: number
  /** The paper's concept count. */
  total: number
  state: 'ready' | 'analyzing' | 'failed'
}

type Network = LibraryNetwork<ConstellationPaper>

const CARD_H = 46
const cardWidth = (w: number) => (w < 760 ? 156 : 184)
/** How far each ring sits outside the card's edge, horizontally and vertically: inner ring, outer ring. */
const RING_DX = [12, 21]
const RING_DY = [12, 19]
const DOT_R = 2.4
const DRIFT_X = 5
const DRIFT_Y = 4
/** Ring speed in radians per millisecond: one turn in about a minute. */
const SPIN = 0.00011
const TOPIC_R = 5.5
/** The label's baseline sits this far above its topic node. */
const LABEL_Y = 10
const LABEL_MAX = 28
/** The strip along the bottom edge kept for the caption. */
const CAPTION_H = 26
/** The least gap between anything drawn and the canvas edge. */
const EDGE = 4
const DRAG_THRESHOLD = 4
/** How long a node takes to glide to its place after a new layout. */
const GLIDE_MS = 450
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3
/** Ticks allowed to bring the web to rest before it is drawn. */
const SETTLE_TICKS = 600

interface SimNode extends SimulationNodeDatum {
  id: string
  kind: 'paper' | 'topic'
  x: number
  y: number
  /** Where the node was last drawn, drift included. */
  drawX: number
  drawY: number
  /** Where the node was last drawn without its drift: part way along a glide, or its place in the web. */
  baseX: number
  baseY: number
  /** Where the current glide started. */
  fromX: number
  fromY: number
  phase: number
  /** How much of its drift a card shows, from 0 while dragged back up to 1. */
  drift: number
  label: string
  labelW: number
  restX: number
  restY: number
  el: HTMLElement | SVGGElement | null
}

interface LinkDatum extends SimulationLinkDatum<SimNode> {
  source: SimNode
  target: SimNode
  pid: string
  key: string
  el: SVGPathElement | null
}

interface Dot {
  paper: SimNode
  pid: string
  ring: 0 | 1
  a0: number
  el: SVGCircleElement | null
}

interface Engine {
  hover: (paperId: string | null, topicKey: string | null) => void
  select: (ids: readonly string[]) => void
  startDrag: (id: string) => void
  dragTo: (id: string, x: number, y: number) => void
  endDrag: (id: string) => void
  /** The card's drawn box in canvas coordinates. */
  cardBox: (id: string) => { left: number; top: number; right: number; bottom: number } | null
  remeasure: () => void
}

type Tip = { kind: 'paper'; id: string } | { kind: 'topic'; key: string }

interface TipApi {
  /** Shows the tip with its top-left corner near (x, y), kept inside the canvas. */
  show: (tip: Tip, x: number, y: number) => void
  move: (x: number, y: number) => void
  hide: () => void
}

const QUERY = '(prefers-reduced-motion: reduce)'

/** Read before the first render, so a reduced-motion reader never sees the web move. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** A stable number in [0, 1) per key, for each card's drift phase. */
function seeded(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const listOf = (items: string[], n: number) => (items.length > n ? `${items.slice(0, n).join(', ')} and ${items.length - n} more` : items.join(', '))
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)))
const mark = (el: Element | null, attr: string, on: boolean) => el?.toggleAttribute(attr, on)

function cardCaption(p: ConstellationPaper, countsReady: boolean) {
  if (p.state === 'failed') return 'Analysis failed'
  if (p.state === 'analyzing') return 'Analyzing…'
  return countsReady ? `${p.known} of ${p.total} known` : '…'
}

export default function TopicConstellation({ network, countsReady }: { network: Network; countsReady: boolean }) {
  const reduced = useReducedMotion()
  const frameRef = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const tip = useRef<TipApi | null>(null)
  // Positions by node id, kept across re-layouts so a filter change moves the web instead of rebuilding it.
  const saved = useRef(new Map<string, { x: number; y: number }>())
  // One clock for the drift and the rings across re-layouts, so neither jumps when the web is laid out again.
  const epoch = useRef(0)
  const latest = useRef(network)
  latest.current = network
  const shape = useMemo(() => networkShape(network), [network])
  const height = constellationHeight(network.papers.length)
  const byId = useMemo(() => new Map(network.papers.map((p) => [p.id, p])), [network])
  const nameOf = useMemo(() => new Map(network.shared.map((s) => [s.key, s.name])), [network])

  // Selection is this component's state, never in the URL. A paper the filters no longer show leaves it.
  const [picked, setPicked] = useState<string[]>([])
  const selected = useMemo(() => keepShown(picked, network), [picked, network])
  useEffect(() => {
    if (selected.length !== picked.length) setPicked(selected)
  }, [selected, picked])
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const toggleSelected = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...keepShown(s, latest.current), id]))
  const clearSelection = () => setPicked([])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const net = latest.current
    let w = frame.clientWidth
    let h = frame.clientHeight
    let cw = cardWidth(w)
    frame.style.setProperty('--cl-card-w', `${cw}px`)
    frame.dataset.settled = 'false'
    const prev = saved.current
    const relayout = prev.size > 0

    const els = <T extends Element>(selector: string, attr: string) => {
      const m = new Map<string, T>()
      frame.querySelectorAll<T>(selector).forEach((el) => m.set(el.getAttribute(attr) ?? '', el))
      return m
    }
    const cardEls = els<HTMLElement>('[data-paper-id]', 'data-paper-id')
    const topicEls = els<SVGGElement>('[data-topic-key]', 'data-topic-key')
    const linkEls = els<SVGPathElement>('[data-link]', 'data-link')
    const dotEls = els<SVGCircleElement>('[data-dot]', 'data-dot')

    // Layout order is by arXiv id, not last opened, so the same papers settle the same way on every visit.
    const order = [...net.papers].sort((a, b) => a.arxivId.localeCompare(b.arxivId) || a.id.localeCompare(b.id))
    const blank = { drawX: 0, drawY: 0, baseX: 0, baseY: 0, fromX: 0, fromY: 0, drift: 1, label: '', labelW: 0, restX: 0, restY: 0 }
    const papers: SimNode[] = order.map((p, i) => {
      const old = prev.get(p.id)
      const x = old?.x ?? w / 2 + Math.cos(i) * 40
      const y = old?.y ?? h / 2 + Math.sin(i) * 40
      return { ...blank, id: p.id, kind: 'paper', x, y, drawX: x, drawY: y, baseX: x, baseY: y, phase: seeded(p.id) * Math.PI * 2, el: cardEls.get(p.id) ?? null }
    })
    const paperNode = new Map(papers.map((n) => [n.id, n]))
    const topics: SimNode[] = net.shared.map((s) => {
      const old = prev.get(`t:${s.key}`)
      const users = s.paperIds.map((id) => paperNode.get(id)!).filter(Boolean)
      const mean = (f: (n: SimNode) => number) => users.reduce((sum, n) => sum + f(n), 0) / Math.max(1, users.length)
      const x = old?.x ?? mean((n) => n.x)
      const y = old?.y ?? mean((n) => n.y)
      return { ...blank, id: `t:${s.key}`, kind: 'topic', x, y, drawX: x, drawY: y, baseX: x, baseY: y, phase: 0, label: cut(s.name, LABEL_MAX), el: topicEls.get(s.key) ?? null }
    })
    const topicNode = new Map(topics.map((n) => [n.id, n]))
    const links: LinkDatum[] = net.shared.flatMap((s) =>
      s.paperIds.map((pid) => ({ source: paperNode.get(pid)!, target: topicNode.get(`t:${s.key}`)!, pid, key: s.key, el: linkEls.get(`${s.key}\n${pid}`) ?? null })),
    )
    const dots: Dot[] = net.papers.flatMap((p) =>
      p.own.map((t, i, all) => ({ paper: paperNode.get(p.id)!, pid: p.id, ring: (i % 2) as 0 | 1, a0: (i / all.length) * Math.PI * 2, el: dotEls.get(`${p.id}\n${t.key}`) ?? null })),
    )

    const measure = () => {
      for (const n of topics) n.labelW = (n.el?.querySelector('text') as SVGTextElement | null)?.getComputedTextLength() ?? n.label.length * 6.5
    }
    measure()

    const paperBounds = () => {
      const ex = cw / 2 + RING_DX[1] + DOT_R + DRIFT_X
      const ey = CARD_H / 2 + RING_DY[1] + DOT_R + DRIFT_Y
      return { x0: ex + EDGE, x1: w - ex - EDGE, y0: ey + EDGE, y1: h - CAPTION_H - ey }
    }
    const clampAll = () => {
      const b = paperBounds()
      for (const n of papers) {
        if (n.fx != null) n.fx = clamp(n.fx, b.x0, b.x1)
        if (n.fy != null) n.fy = clamp(n.fy, b.y0, b.y1)
        n.x = clamp(n.x, b.x0, b.x1)
        n.y = clamp(n.y, b.y0, b.y1)
      }
      for (const n of topics) {
        const ex = Math.max(TOPIC_R, n.labelW / 2) + EDGE
        n.x = clamp(n.x, ex, w - ex)
        n.y = clamp(n.y, LABEL_Y + 12 + EDGE, h - CAPTION_H - TOPIC_R)
      }
    }

    const sim: Simulation<SimNode, LinkDatum> = forceSimulation<SimNode, LinkDatum>([...papers, ...topics])
      .force('link', forceLink<SimNode, LinkDatum>(links).distance(105).strength(0.5))
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.kind === 'paper' ? -1100 : -160)))
      .force('collide', forceCollide<SimNode>().strength(0.9))
      .force('x', forceX<SimNode>().strength((d) => (d.kind === 'paper' ? 0.045 : 0.02)))
      .force('y', forceY<SimNode>().strength((d) => (d.kind === 'paper' ? 0.085 : 0.03)))
      .stop()
    const fitForces = () => {
      ;(sim.force('collide') as ForceCollide<SimNode>).radius((d) => (d.kind === 'paper' ? cw * 0.62 : Math.max(30, d.label.length * 3.4)))
      ;(sim.force('x') as ForceX<SimNode>).x(w / 2)
      ;(sim.force('y') as ForceY<SimNode>).y((h - CAPTION_H) / 2)
    }
    fitForces()
    clampAll()
    sim.alpha(relayout ? 0.5 : 1)

    const settleNow = () => {
      for (let i = 0; i < SETTLE_TICKS && sim.alpha() >= sim.alphaMin(); i++) {
        sim.tick()
        clampAll()
      }
    }

    // A glide in progress, timed on the same clock as draw(). A held (dragged) node is drawn where it is held.
    let glide: { start: number } | null = null
    const place = (n: SimNode, p: number) => {
      const q = n.fx != null ? 1 : p
      n.baseX = q < 1 ? n.fromX + (n.x - n.fromX) * q : n.x
      n.baseY = q < 1 ? n.fromY + (n.y - n.fromY) * q : n.y
    }
    const draw = (t: number) => {
      const p = glide ? easeOutCubic(Math.min(1, (t - glide.start) / GLIDE_MS)) : 1
      for (const n of papers) {
        place(n, p)
        const k = reduced ? 0 : n.drift
        n.drawX = n.baseX + Math.sin(t * 0.00045 + n.phase) * DRIFT_X * k
        n.drawY = n.baseY + Math.cos(t * 0.00035 + n.phase) * DRIFT_Y * k
        if (n.el) n.el.style.transform = `translate(${n.drawX - cw / 2}px, ${n.drawY - CARD_H / 2}px)`
      }
      for (const n of topics) {
        place(n, p)
        n.drawX = n.baseX
        n.drawY = n.baseY
        n.el?.setAttribute('transform', `translate(${n.drawX},${n.drawY})`)
      }
      for (const l of links) l.el?.setAttribute('d', `M${l.source.drawX},${l.source.drawY}L${l.target.drawX},${l.target.drawY}`)
      const spin = reduced ? 0 : t * SPIN
      for (const d of dots) {
        if (!d.el) continue
        const a = d.a0 + spin * (d.ring ? -1 : 1)
        d.el.setAttribute('cx', String(d.paper.drawX + Math.cos(a) * (cw / 2 + RING_DX[d.ring])))
        d.el.setAttribute('cy', String(d.paper.drawY + Math.sin(a) * (CARD_H / 2 + RING_DY[d.ring])))
      }
    }

    let raf = 0
    let cancelled = false
    if (!epoch.current) epoch.current = performance.now()
    const t0 = epoch.current
    const now = () => (reduced ? 0 : performance.now() - t0)
    const settled = (yes: boolean) => {
      if (frame.dataset.settled !== String(yes)) frame.dataset.settled = String(yes)
    }
    const running = () => sim.alpha() >= sim.alphaMin() || sim.alphaTarget() > 0
    const all = [...papers, ...topics]
    /** Brings the web to rest at once, and glides each node from where it is drawn to its new place. */
    const settleAndGlide = (heat: number) => {
      for (const n of all) {
        n.fromX = n.baseX
        n.fromY = n.baseY
      }
      sim.alpha(Math.max(sim.alpha(), heat))
      settleNow()
      glide = { start: now() }
      settled(false)
    }

    if (reduced) {
      settleNow()
      draw(0)
      settled(true)
    } else {
      // The first layout is drawn at rest (the canvas fades in); a re-layout glides from the old one.
      if (relayout) settleAndGlide(0.5)
      else {
        settleNow()
        settled(true)
      }
      draw(now())
      let last = performance.now()
      const loop = (time: number) => {
        const dt = Math.min(0.05, (time - last) / 1000)
        last = time
        const t = time - t0
        if (running()) {
          sim.tick()
          clampAll()
        }
        if (glide && t - glide.start >= GLIDE_MS) glide = null
        if (!running() && !glide) settled(true)
        for (const n of papers) n.drift += ((n.fx == null ? 1 : 0) - n.drift) * Math.min(1, dt * 3)
        draw(t)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    // A wider or narrower canvas re-centers the web: at once under reduced motion, otherwise by reheating it.
    const ro = new ResizeObserver(() => {
      const nw = frame.clientWidth
      const nh = frame.clientHeight
      if (nw === w && nh === h) return
      w = nw
      h = nh
      cw = cardWidth(w)
      frame.style.setProperty('--cl-card-w', `${cw}px`)
      fitForces()
      clampAll()
      if (reduced) {
        sim.alpha(Math.max(sim.alpha(), 0.3))
        settleNow()
        draw(0)
        settled(true)
      } else settleAndGlide(0.3)
    })
    ro.observe(frame)
    // Topic labels are measured for the bounds, and measured again once the web fonts have loaded.
    void document.fonts?.ready.then(() => {
      if (cancelled) return
      measure()
      clampAll()
      if (reduced) draw(0)
    })

    // What is emphasized: the selection when there is one, else whatever is hovered. Everything else is dimmed,
    // and with a selection, hovering something else lifts it part way (data-preview) without changing the selection.
    const near = (paperId: string | null, topicKey: string | null) => {
      const ids = new Set<string>()
      if (paperId) {
        ids.add(paperId)
        for (const s of net.shared) if (s.paperIds.includes(paperId)) ids.add(`t:${s.key}`)
      }
      if (topicKey) {
        ids.add(`t:${topicKey}`)
        for (const id of net.shared.find((s) => s.key === topicKey)?.paperIds ?? []) ids.add(id)
      }
      return ids
    }
    let hoverPaper: string | null = null
    let hoverTopic: string | null = null
    let sel: readonly string[] = selectedRef.current
    const paint = () => {
      const chosen = new Set(sel)
      const hovering = !!(hoverPaper || hoverTopic)
      let full: Set<string> | null = null
      let linkOn: (l: LinkDatum) => boolean = () => false
      let dotOn: (pid: string) => boolean = () => false
      let all = new Set<string>()
      let preview = new Set<string>()
      let previewLink: (l: LinkDatum) => boolean = () => false
      if (!chosen.size) {
        if (hovering) {
          full = near(hoverPaper, hoverTopic)
          linkOn = (l) => l.pid === hoverPaper || l.key === hoverTopic
          dotOn = (pid) => pid === hoverPaper
        }
      } else {
        const connections = selectionConnections(net, sel)
        if (chosen.size === 1) {
          const [only] = sel
          full = near(only, null)
          linkOn = (l) => l.pid === only
          dotOn = (pid) => pid === only
        } else {
          const keys = new Set(connections.map((c) => c.key))
          full = new Set([...sel, ...[...keys].map((k) => `t:${k}`)])
          linkOn = (l) => keys.has(l.key) && chosen.has(l.pid)
          dotOn = (pid) => chosen.has(pid)
          all = new Set(connections.filter((c) => c.all).map((c) => c.key))
        }
        if (hoverPaper && !chosen.has(hoverPaper)) {
          preview = near(hoverPaper, null)
          previewLink = (l) => l.pid === hoverPaper
        } else if (hoverTopic) {
          preview = near(null, hoverTopic)
          previewLink = (l) => l.key === hoverTopic
        }
      }
      for (const n of [...papers, ...topics]) {
        const dim = !!full && !full.has(n.id)
        mark(n.el, 'data-dim', dim)
        mark(n.el, 'data-preview', dim && preview.has(n.id))
        mark(n.el, 'data-hi', n.id === hoverPaper || n.id === `t:${hoverTopic}`)
      }
      for (const n of topics) mark(n.el, 'data-all', all.has(n.id.slice(2)))
      for (const l of links) {
        const on = !!full && linkOn(l)
        mark(l.el, 'data-hi', on)
        mark(l.el, 'data-dim', !!full && !on)
        mark(l.el, 'data-preview', !!full && !on && previewLink(l))
      }
      for (const d of dots) {
        const dim = !!full && !dotOn(d.pid)
        mark(d.el, 'data-dim', dim)
        mark(d.el, 'data-preview', dim && d.pid === hoverPaper)
      }
    }

    engine.current = {
      hover(paperId, topicKey) {
        hoverPaper = paperId
        hoverTopic = topicKey
        paint()
      },
      select(ids) {
        sel = ids
        paint()
      },
      startDrag(id) {
        const n = paperNode.get(id)
        if (!n) return
        // Held where it is drawn, so the card doesn't jump when its drift stops.
        n.fx = n.drawX
        n.fy = n.drawY
        n.drift = 0
        n.restX = n.x
        n.restY = n.y
        if (!reduced) {
          sim.alphaTarget(0.25)
          settled(false)
        }
      },
      dragTo(id, x, y) {
        const n = paperNode.get(id)
        if (!n) return
        const b = paperBounds()
        n.fx = clamp(x, b.x0, b.x1)
        n.fy = clamp(y, b.y0, b.y1)
        if (reduced) {
          n.x = n.fx
          n.y = n.fy
          draw(0)
        }
      },
      endDrag(id) {
        const n = paperNode.get(id)
        if (!n) return
        n.fx = null
        n.fy = null
        if (reduced) {
          n.x = n.restX
          n.y = n.restY
          draw(0)
        } else sim.alphaTarget(0)
      },
      cardBox(id) {
        const n = paperNode.get(id)
        if (!n) return null
        return { left: n.drawX - cw / 2, top: n.drawY - CARD_H / 2, right: n.drawX + cw / 2, bottom: n.drawY + CARD_H / 2 }
      },
      remeasure() {
        measure()
        clampAll()
        draw(now())
      },
    }
    paint()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      sim.stop()
      ro.disconnect()
      // Where each node is drawn, so a re-layout that interrupts a glide starts from what is on screen.
      for (const n of all) prev.set(n.id, { x: n.baseX, y: n.baseY })
      engine.current = null
    }
    // `shape` stands for the network's structure; names, counts and checkmarks don't need a new layout.
  }, [shape, reduced])

  // New names change the labels' widths, and so the topics' bounds.
  useLayoutEffect(() => {
    engine.current?.remeasure()
  }, [network])

  useLayoutEffect(() => {
    engine.current?.select(selected)
  }, [selected])

  // Esc clears the selection, unless it is closing something else or typed into a field.
  const hasSelection = selected.length > 0
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [role="dialog"], [role="listbox"]')) return
      setPicked([])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasSelection])

  // Pointer drag with a 4px threshold. The click that ends a drag neither selects, opens nor clears anything:
  // the browser dispatches it in the same task as the pointerup, so a flag cleared by the next task catches it.
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)
  const fromDrag = () => {
    const yes = swallowClick.current
    swallowClick.current = false
    return yes
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const endDrag = (e: ReactPointerEvent<HTMLLIElement>) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 0)
    delete e.currentTarget.dataset.dragging
    engine.current?.endDrag(d.id)
  }
  const cardHandlers = (id: string) => ({
    onPointerDown(e: ReactPointerEvent<HTMLLIElement>) {
      if (e.button !== 0) return
      const box = engine.current?.cardBox(id)
      if (!box) return
      const p = local(e)
      drag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x - (box.left + box.right) / 2, oy: p.y - (box.top + box.bottom) / 2, moved: false }
    },
    onPointerMove(e: ReactPointerEvent<HTMLLIElement>) {
      const d = drag.current
      if (!d) {
        const p = local(e)
        tip.current?.move(p.x + 14, p.y + 14)
        return
      }
      if (d.id !== id) return
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_THRESHOLD) {
        d.moved = true
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.dataset.dragging = 'true'
        tip.current?.hide()
        engine.current?.startDrag(id)
      }
      if (d.moved) {
        const p = local(e)
        engine.current?.dragTo(id, p.x - d.ox, p.y - d.oy)
      }
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onPointerEnter(e: ReactPointerEvent<HTMLLIElement>) {
      if (drag.current) return
      engine.current?.hover(id, null)
      const p = local(e)
      tip.current?.show({ kind: 'paper', id }, p.x + 14, p.y + 14)
    },
    onPointerLeave() {
      if (drag.current) return
      engine.current?.hover(null, null)
      tip.current?.hide()
    },
    onFocus(e: React.FocusEvent<HTMLLIElement>) {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      engine.current?.hover(id, null)
      const box = engine.current?.cardBox(id)
      if (box) tip.current?.show({ kind: 'paper', id }, box.left, box.bottom + 8)
    },
    onBlur(e: React.FocusEvent<HTMLLIElement>) {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      engine.current?.hover(null, null)
      tip.current?.hide()
    },
    onClickCapture(e: React.MouseEvent) {
      if (!fromDrag()) return
      e.preventDefault()
      e.stopPropagation()
    },
  })
  const topicHandlers = (key: string) => ({
    onPointerEnter(e: ReactPointerEvent<SVGGElement>) {
      if (drag.current) return
      engine.current?.hover(null, key)
      const p = local(e)
      tip.current?.show({ kind: 'topic', key }, p.x + 14, p.y + 14)
    },
    onPointerMove(e: ReactPointerEvent<SVGGElement>) {
      if (drag.current) return
      const p = local(e)
      tip.current?.move(p.x + 14, p.y + 14)
    },
    onPointerLeave() {
      if (drag.current) return
      engine.current?.hover(null, null)
      tip.current?.hide()
    },
  })

  const links = network.shared.flatMap((s) => s.paperIds.map((pid) => `${s.key}\n${pid}`))
  const dots = network.papers.flatMap((p) => p.own.map((t) => ({ id: `${p.id}\n${t.key}`, checked: t.checked })))
  const caption = `${plural(network.papers.length, 'paper', 'papers')}, ${
    network.shared.length ? plural(network.shared.length, 'shared topic', 'shared topics') : 'no shared topics'
  }. Dots around a card are topics only that paper uses, green when checked.`
  const chosen = new Set(selected)

  return (
    <div className="grid gap-3">
      <div
        ref={frameRef}
        role="group"
        aria-label="Topic constellation"
        tabIndex={-1}
        data-testid="library-constellation"
        className="dot-grid relative overflow-hidden rounded-lg border border-border outline-none"
        style={{ height }}
        // A click on empty canvas clears the selection; clicks on cards and topics land on their own elements.
        onClick={(e) => {
          if (e.target === e.currentTarget && !fromDrag()) clearSelection()
        }}
      >
        <svg className="cl-enter pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <g>
            {links.map((id) => (
              <path key={id} className="cl-link" data-link={id} />
            ))}
          </g>
          <g>
            {dots.map((d) => (
              <circle key={d.id} className="cl-dot" r={DOT_R} data-dot={d.id} data-checked={d.checked || undefined} data-testid="constellation-dot" />
            ))}
          </g>
          <g>
            {network.shared.map((s) => (
              <g key={s.key} className="cl-topic" data-topic-key={s.key} data-checked={s.checked || undefined} data-testid="constellation-topic" {...topicHandlers(s.key)}>
                <circle className="cl-hit" r={12} />
                <circle className="cl-ring" r={TOPIC_R + 3.5} />
                <circle className="cl-node" r={TOPIC_R} />
                <text y={-LABEL_Y} textAnchor="middle">
                  {cut(s.name, LABEL_MAX)}
                </text>
              </g>
            ))}
          </g>
        </svg>
        <ul className="cl-enter">
          {network.papers.map((p) => {
            const on = chosen.has(p.id)
            const shares = sharedWith(network, p.id)
              .map((x) => `Shares ${listOf(x.keys.map((k) => nameOf.get(k) ?? k), 3)} with ${byId.get(x.id)?.title ?? ''}.`)
              .join(' ')
            return (
              <li
                key={p.id}
                className="cl-card"
                data-paper-id={p.id}
                data-arxiv={p.arxivId}
                data-selected={on || undefined}
                data-testid="constellation-card"
                {...cardHandlers(p.id)}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSelected(p.id)}
                  className="block h-full w-full cursor-pointer rounded-[inherit] px-2.5 py-[7px] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                  data-testid="constellation-select"
                >
                  <span className="block truncate text-[12.5px] font-semibold leading-4">{p.title}</span>
                  <span className="mt-0.5 block font-mono text-[10px] leading-4 tracking-[0.02em] text-muted-foreground" data-testid="constellation-known">
                    {cardCaption(p, countsReady)}
                  </span>
                  {shares && <span className="sr-only">{shares}</span>}
                </button>
                {on && (
                  <Link
                    to={`/p/${arxivSlug(p.arxivId)}`}
                    draggable={false}
                    aria-label={`Open ${p.title}`}
                    className="absolute bottom-[5px] right-[7px] inline-flex items-center gap-0.5 rounded-[3px] bg-accent-soft px-1.5 text-[11px] font-medium leading-[17px] text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    data-testid="constellation-open"
                  >
                    Open <ArrowRightIcon size={11} weight={2} />
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
        <TipLayer api={tip} network={network} byId={byId} countsReady={countsReady} />
        <p className="pointer-events-none absolute bottom-2 left-3.5 right-3.5 truncate text-xs text-faint">{caption}</p>
      </div>
      <SelectionPanel
        network={network}
        selected={selected}
        byId={byId}
        onClear={() => {
          clearSelection()
          frameRef.current?.focus()
        }}
      />
    </div>
  )
}

/**
 * What is selected and the topics that connect it. The first line is a live
 * region, so a screen reader hears each change of selection.
 */
function SelectionPanel({
  network,
  selected,
  byId,
  onClear,
}: {
  network: Network
  selected: readonly string[]
  byId: Map<string, ConstellationPaper>
  onClear: () => void
}) {
  const connections = useMemo(() => selectionConnections(network, selected), [network, selected])
  const k = selected.length
  const all = connections.filter((c) => c.all)
  const some = connections.filter((c) => !c.all)
  const title = (id: string) => byId.get(id)?.title ?? ''
  const titles = (ids: string[]) => ids.map((id) => cut(title(id), 40)).join(', ')
  const papers = useMemo(
    () => selected.map((id) => ({ paperId: id, arxivId: byId.get(id)?.arxivId ?? '', title: byId.get(id)?.title ?? '' })),
    [selected, byId],
  )

  const status =
    k === 0
      ? 'Select a paper to keep its topics highlighted, or select several to see the topics they share.'
      : k === 1
        ? `1 paper selected. ${connections.length ? `It shares ${plural(connections.length, 'topic', 'topics')} with other papers here.` : 'It shares no topics with the other papers here.'}`
        : `${k} papers selected. ${
            !connections.length
              ? 'These papers share no topics.'
              : k === 2
                ? `They share ${plural(connections.length, 'topic', 'topics')}.`
                : `They share ${plural(connections.length, 'topic', 'topics')}, ${all.length ? `${all.length} of them used by all ${k}` : `none used by all ${k}`}.`
          }`

  return (
    <section
      aria-label="Selected papers"
      className={cn('grid gap-3 text-sm', k > 0 && 'surface p-4')}
      data-testid="constellation-selection"
      data-count={k}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p role="status" className={cn('min-w-0', k === 0 ? 'text-muted-foreground' : 'font-medium')} data-testid="constellation-selection-status">
          {status}
        </p>
        {k > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <PlacementControl mode="add" papers={papers} testId="constellation-add" />
            <Button size="sm" variant="outline" onClick={onClear} data-testid="constellation-clear">
              Clear
            </Button>
          </div>
        )}
      </div>
      {k > 0 && (
        <>
          <div>
            <p className="label mb-1">Selected</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {selected.map((id) => (
                <li key={id} className="min-w-0 max-w-full">
                  <Link to={`/p/${arxivSlug(byId.get(id)?.arxivId ?? '')}`} className="block truncate font-medium text-primary hover:underline" data-testid="constellation-selection-paper">
                    {title(id)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {k === 1 && connections.length > 0 && <TopicRows heading="Topics it shares" items={connections} papersOf={(c) => `with ${titles(c.others)}`} />}
          {k === 2 && connections.length > 0 && <TopicChips heading="Topics both use" items={connections} />}
          {k > 2 && all.length > 0 && <TopicChips heading={`Used by all ${k}`} items={all} />}
          {k > 2 && some.length > 0 && <TopicRows heading="Used by some" items={some} papersOf={(c) => titles(c.selected)} />}
        </>
      )}
    </section>
  )
}

/** A topic's mark in the panel, drawn like its node: green when checked, else an accent outline. */
function NodeMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-[9px] flex-none rounded-full border-[1.5px]', checked ? 'border-known bg-known' : 'border-primary bg-card')}
    />
  )
}

function TopicChips({ heading, items }: { heading: string; items: Connection[] }) {
  return (
    <div>
      <p className="label mb-1.5">{heading}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <li
            key={c.key}
            className="inline-flex items-center gap-1.5 rounded-[3px] border border-border bg-surface-2 px-2 py-0.5 text-[13px]"
            data-testid="constellation-selection-topic"
            data-topic-key={c.key}
          >
            <NodeMark checked={c.checked} />
            {c.name}
            {c.checked && <span className="sr-only"> (checked)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TopicRows({ heading, items, papersOf }: { heading: string; items: Connection[]; papersOf: (c: Connection) => string }) {
  return (
    <div>
      <p className="label mb-1.5">{heading}</p>
      <ul className="grid gap-1">
        {items.map((c) => (
          <li key={c.key} className="flex min-w-0 items-baseline gap-1.5" data-testid="constellation-selection-topic" data-topic-key={c.key}>
            <span className="relative top-[1px]">
              <NodeMark checked={c.checked} />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{c.name}</span>
              {c.checked && <span className="sr-only"> (checked)</span>}
              <span className="text-muted-foreground"> {papersOf(c)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The tooltip, in its own component so showing it re-renders only the tip.
 * It is aria-hidden: each card's button text already carries what it shares.
 */
function TipLayer({
  api,
  network,
  byId,
  countsReady,
}: {
  api: RefObject<TipApi | null>
  network: Network
  byId: Map<string, ConstellationPaper>
  countsReady: boolean
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [on, setOn] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const at = useRef({ x: 0, y: 0 })

  const place = () => {
    const el = box.current
    const frame = el?.parentElement
    if (!el || !frame) return
    el.style.left = `${clamp(at.current.x, 8, frame.clientWidth - el.offsetWidth - 8)}px`
    el.style.top = `${clamp(at.current.y, 8, frame.clientHeight - el.offsetHeight - 8)}px`
  }
  useLayoutEffect(() => {
    api.current = {
      show(next, x, y) {
        at.current = { x, y }
        setTip(next)
        setOn(true)
        place()
      },
      move(x, y) {
        at.current = { x, y }
        place()
      },
      hide() {
        setOn(false)
      },
    }
    return () => {
      api.current = null
    }
  }, [api])
  // Placed again once the new content has its size.
  useLayoutEffect(place, [tip, network])

  const paper = tip?.kind === 'paper' ? byId.get(tip.id) : undefined
  const topic = tip?.kind === 'topic' ? network.shared.find((s) => s.key === tip.key) : undefined
  const nameOf = (key: string) => network.shared.find((s) => s.key === key)?.name ?? key
  const pairs = paper ? sharedWith(network, paper.id) : []

  return (
    <div
      ref={box}
      aria-hidden="true"
      data-testid="constellation-tip"
      data-on={on || undefined}
      className="pointer-events-none absolute left-0 top-0 z-20 max-w-[300px] rounded-[7px] border border-transparent bg-popover px-3 py-2.5 text-[12.5px] leading-[1.45] text-popover-foreground opacity-0 shadow-[var(--shadow-ring-hi)] transition-opacity duration-150 data-[on]:opacity-100"
    >
      {paper ? (
        <>
          <p className="font-semibold">{paper.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">arXiv {paper.arxivId}</p>
          <p className="label mt-1.5">Checked</p>
          <p>
            {paper.state !== 'ready' ? (
              cardCaption(paper, countsReady)
            ) : countsReady ? (
              <>
                <span className="font-medium text-known">{paper.known}</span> of {plural(paper.total, 'concept', 'concepts')}
              </>
            ) : (
              '…'
            )}
          </p>
          <p className="label mt-1.5">Shares topics with</p>
          {!pairs.length && <p className="text-muted-foreground">No other paper shown here</p>}
          {pairs.slice(0, 6).map((x) => (
            <p key={x.id}>
              <span className="font-medium">{cut(byId.get(x.id)?.title ?? '', 38)}</span>: {listOf(x.keys.map(nameOf), 4)}
            </p>
          ))}
          {pairs.length > 6 && <p className="text-muted-foreground">and {plural(pairs.length - 6, 'more paper', 'more papers')}</p>}
        </>
      ) : topic ? (
        <>
          <p>
            <span className="font-semibold">{topic.name}</span>
            {topic.checked && <span className="font-medium text-known"> checked</span>}
          </p>
          <p className="label mt-1.5">Used by {plural(topic.paperIds.length, 'paper', 'papers')}</p>
          {topic.paperIds.map((id) => (
            <p key={id}>{cut(byId.get(id)?.title ?? '', 44)}</p>
          ))}
        </>
      ) : null}
    </div>
  )
}
