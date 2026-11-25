/**
 * A floating node graph: one center card with nodes placed around it on an
 * ellipse, joined by dashed elbow links. Ported from design/theme-trials.html.
 *
 * Motion runs in one requestAnimationFrame loop that writes transforms
 * directly (no React render per frame):
 * - nodes drift slowly around their base position,
 * - a dragged node follows the pointer and settles back on release,
 * - the center and the graph scale re-center when the canvas resizes,
 * all on critically damped springs (k = 40, c = 2√k), so nothing overshoots.
 *
 * Under prefers-reduced-motion the graph is static: no drift, no springs, and
 * a dragged node returns to its place on release.
 *
 * Narrow canvases (under 640px) and the prerendered HTML get a stacked list
 * instead, with the same node content.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface GraphNode {
  key: string
  /** Node content. Put interactive controls inside; the wrapper handles drag. */
  content: ReactNode
  /** Width in px used for layout spacing (the content sets its own width). */
  width?: number
  hot?: boolean
  dashed?: boolean
}

interface NodeState {
  x: number
  y: number
  vx: number
  vy: number
  bx: number
  by: number
  ax: number
  ay: number
  px: number
  py: number
  fx: number
  fy: number
  dragging: boolean
  el: HTMLDivElement | null
  path: SVGPathElement | null
}

const STACK_BELOW = 640
const K = 40
const C = 2 * Math.sqrt(K) // critically damped: settles without overshoot

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** Deterministic pseudo-random drift parameters per key, so layouts are stable across renders. */
function seeded(key: string, salt: number) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

export function FloatingGraph({
  center,
  nodes,
  className,
  label,
  testId,
}: {
  center: ReactNode
  nodes: GraphNode[]
  className?: string
  label: string
  testId?: string
}) {
  const reduced = usePrefersReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const states = useRef(new Map<string, NodeState>())
  const geo = useRef({ w: 0, h: 0, cx: 0, cy: 0, ccx: 0, ccy: 0, cvx: 0, cvy: 0, gs: 1, gsc: 1, gv: 0, placed: false })
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const [mode, setMode] = useState<'stack' | 'graph'>('stack')
  const hotKeys = useRef(new Set<string>())
  hotKeys.current = new Set(nodes.filter((n) => n.hot).map((n) => n.key))

  const keys = nodes.map((n) => n.key)
  const keysSig = keys.join('|')

  const stateFor = useCallback((key: string): NodeState => {
    let s = states.current.get(key)
    if (!s) {
      s = {
        x: 0, y: 0, vx: 0, vy: 0, bx: 0, by: 0, dragging: false, el: null, path: null,
        ax: 5 + seeded(key, 1) * 5,
        ay: 4 + seeded(key, 2) * 5,
        px: 6500 + seeded(key, 3) * 4500,
        py: 7000 + seeded(key, 4) * 5000,
        fx: seeded(key, 5) * Math.PI * 2,
        fy: seeded(key, 6) * Math.PI * 2,
      }
      states.current.set(key, s)
    }
    return s
  }, [])

  const render = useCallback(() => {
    const g = geo.current
    const cx = g.ccx
    const cy = g.ccy
    if (centerRef.current) centerRef.current.style.transform = `translate(${cx}px, ${cy}px) scale(${g.gsc})`
    for (const [key, s] of states.current) {
      if (s.el) s.el.style.transform = `translate(${s.x}px, ${s.y}px) scale(${g.gsc})`
      if (s.path) {
        const mx = (cx + s.x) / 2
        s.path.setAttribute('d', `M${cx},${cy} L${mx},${cy} L${mx},${s.y} L${s.x},${s.y}`)
        s.path.classList.toggle('hot', hotKeys.current.has(key))
      }
    }
  }, [])

  const layout = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const g = geo.current
    g.w = w
    g.h = h
    const n = keysSig ? keysSig.split('|').length : 0
    g.cx = w * 0.5
    g.cy = h * 0.5
    // Shrink the graph in tight space, and keep nodes clear of the center card.
    g.gs = Math.max(0.72, Math.min(1, w / 1000))
    const rx = Math.max(Math.min(w * 0.36, 440), 290 * g.gs)
    const ry = Math.max(Math.min(h * 0.36, 260), 150)
    const list = keysSig ? keysSig.split('|') : []
    list.forEach((key, i) => {
      const s = stateFor(key)
      const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + 0.35
      s.bx = g.cx + Math.cos(a) * rx
      s.by = g.cy + Math.sin(a) * ry
      if (!g.placed || reducedRef.current || (s.x === 0 && s.y === 0)) {
        s.x = s.bx
        s.y = s.by
        s.vx = s.vy = 0
      }
    })
    if (!g.placed || reducedRef.current) {
      g.ccx = g.cx
      g.ccy = g.cy
      g.cvx = g.cvy = 0
      g.gsc = g.gs
      g.gv = 0
    }
    g.placed = true
    render()
  }, [keysSig, render, stateFor])

  // Measure before paint so wide screens never flash the stacked list.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const next = el.clientWidth >= STACK_BELOW ? 'graph' : 'stack'
      setMode((m) => (m === next ? m : next))
      if (next === 'graph') layout()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout])

  useLayoutEffect(() => {
    if (mode === 'graph') layout()
  }, [mode, layout])

  // Drop state for nodes that went away.
  useEffect(() => {
    const live = new Set(keys)
    for (const k of [...states.current.keys()]) if (!live.has(k)) states.current.delete(k)
  }, [keysSig]) // keysSig is the stable form of keys

  // One animation loop per graph; it idles under reduced motion and in stack mode.
  useEffect(() => {
    if (mode !== 'graph' || reduced) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const g = geo.current
      g.cvx += (K * (g.cx - g.ccx) - C * g.cvx) * dt
      g.cvy += (K * (g.cy - g.ccy) - C * g.cvy) * dt
      g.ccx += g.cvx * dt
      g.ccy += g.cvy * dt
      g.gv += (K * (g.gs - g.gsc) - C * g.gv) * dt
      g.gsc += g.gv * dt
      for (const s of states.current.values()) {
        if (s.dragging) continue
        const tx = s.bx + Math.sin((now / s.px) * Math.PI * 2 + s.fx) * s.ax
        const ty = s.by + Math.sin((now / s.py) * Math.PI * 2 + s.fy) * s.ay
        s.vx += (K * (tx - s.x) - C * s.vx) * dt
        s.vy += (K * (ty - s.y) - C * s.vy) * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
      }
      render()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, reduced, render])

  // Pointer drag with a 4px threshold; a drag suppresses the click that follows.
  const drag = useRef<{ key: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const suppressClick = useRef<string | null>(null)

  const onPointerDown = (key: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'graph' || e.button !== 0) return
    const r = containerRef.current!.getBoundingClientRect()
    const s = stateFor(key)
    drag.current = { key, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left - s.x, oy: e.clientY - r.top - s.y, moved: false }
  }
  const onPointerMove = (key: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.key !== key) return
    const s = stateFor(key)
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) {
      d.moved = true
      s.dragging = true
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.dataset.dragging = 'true'
    }
    if (s.dragging) {
      const r = containerRef.current!.getBoundingClientRect()
      s.x = e.clientX - r.left - d.ox
      s.y = e.clientY - r.top - d.oy
      s.vx = s.vy = 0
      if (reducedRef.current) render()
    }
  }
  const endDrag = (key: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.key !== key) return
    const s = stateFor(key)
    if (d.moved) suppressClick.current = key
    s.dragging = false
    delete e.currentTarget.dataset.dragging
    drag.current = null
    if (reducedRef.current) {
      s.x = s.bx
      s.y = s.by
      render()
    }
  }
  const onClickCapture = (key: string) => (e: React.MouseEvent) => {
    if (suppressClick.current === key) {
      suppressClick.current = null
      e.preventDefault()
      e.stopPropagation()
    }
  }

  if (mode === 'stack') {
    return (
      <div ref={containerRef} role="group" aria-label={label} data-testid={testId} data-mode="stack" className={cn('flex flex-col gap-3 p-4', className)}>
        <div className="enter" style={{ ['--i' as string]: 0 }}>{center}</div>
        <ul className="flex flex-col gap-2.5">
          {nodes.map((n, i) => (
            <li key={n.key} className="enter" style={{ ['--i' as string]: Math.min(i + 1, 6) }}>{n.content}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={label}
      data-testid={testId}
      data-mode="graph"
      className={cn('dot-grid relative touch-none overflow-hidden', className)}
    >
      <svg className="graph-links pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {/* Each link enters with its node (the same --i), so a line never leads to a card that hasn't appeared. */}
        {nodes.map((n, i) => (
          <path
            key={n.key}
            ref={(el) => {
              stateFor(n.key).path = el
            }}
            style={{ ['--i' as string]: Math.min(i + 1, 8) }}
          />
        ))}
      </svg>
      <div ref={centerRef} className="absolute left-0 top-0 origin-top-left">
        <div className="enter -translate-x-1/2 -translate-y-1/2" style={{ ['--i' as string]: 0 }}>{center}</div>
      </div>
      <ul>
        {nodes.map((n, i) => (
          <li key={n.key}>
            <div
              ref={(el) => {
                stateFor(n.key).el = el
              }}
              className="graph-node absolute left-0 top-0 origin-top-left"
              onPointerDown={onPointerDown(n.key)}
              onPointerMove={onPointerMove(n.key)}
              onPointerUp={endDrag(n.key)}
              onPointerCancel={endDrag(n.key)}
              onClickCapture={onClickCapture(n.key)}
            >
              <div className="enter -translate-x-1/2 -translate-y-1/2" style={{ ['--i' as string]: Math.min(i + 1, 8) }}>
                {n.content}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
