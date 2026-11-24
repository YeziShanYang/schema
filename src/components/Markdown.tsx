/**
 * A small Markdown renderer for model-written explanations: headings, bold,
 * italics, inline code, fenced code blocks, bullet and numbered lists, and
 * paragraphs. It builds React elements (no HTML strings), so model output
 * can never inject markup.
 */

import type { ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // `code`, **bold**, *italic* / _italic_
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`
    if (tok.startsWith('`')) out.push(<code key={key} className="rounded-[3px] bg-card px-1 font-mono text-[12px]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++
      blocks.push(
        <pre key={k++} className="overflow-x-auto rounded bg-card px-3 py-2 font-mono text-[12px] leading-relaxed">
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push(<p key={k++} className="font-semibold text-foreground">{inline(h[2], `h${k}`)}</p>)
      i++
      continue
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={k++} className={(ordered ? 'list-decimal' : 'list-disc') + ' space-y-0.5 pl-5'}>
          {items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}
        </List>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*([-*]|\d+[.)])\s|^\s*```/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>)
  }
  return <div className={'space-y-2 ' + (className ?? '')}>{blocks}</div>
}

/** Page titles often end in "| Site" or "- site.com"; show the part that names the page. */
export function cleanTitle(title: string): string {
  let t = title.split(' | ')[0]
  t = t.replace(/\s[-–—]\s[\w.-]+\.(com|org|io|net|dev|ai|edu)$/i, '')
  return t.trim().length >= 8 ? t.trim() : title
}
