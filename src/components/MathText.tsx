/**
 * Text with inline \( \) and display \[ \] math, plus $…$ and $$…$$ when no
 * space follows the opening $, so prices stay text (see src/lib/math.ts).
 * Plain text renders as is. KaTeX loads only when a string contains math,
 * and the raw source shows until it has loaded.
 */

import { useEffect, useMemo, useState } from 'react'
import type katexType from 'katex'
import { parseMath } from '../lib/math'
import { loadKatex, renderMath } from '../lib/katex-loader'

export function MathText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => parseMath(text ?? ''), [text])
  const needsMath = segments.some((s) => s.type === 'math')
  const [katex, setKatex] = useState<typeof katexType | null>(null)

  useEffect(() => {
    if (!needsMath || katex) return
    let alive = true
    void loadKatex().then((k) => {
      if (alive) setKatex(() => k)
    })
    return () => {
      alive = false
    }
  }, [needsMath, katex])

  if (!needsMath) return <span className={className}>{text}</span>
  return (
    <span className={className} data-math="true">
      {segments.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.value}</span>
        if (!katex) return <span key={i} className="font-mono text-[0.92em]">{s.value}</span>
        // KaTeX builds this markup from the formula with trust off, so no model-written HTML reaches the page.
        const html = renderMath(katex, s.value, s.display)
        return s.display ? (
          <span key={i} className="my-1 block overflow-x-auto overscroll-x-contain" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        )
      })}
    </span>
  )
}
