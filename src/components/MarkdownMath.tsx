/**
 * Markdown with math for AI explanations: react-markdown (raw HTML is never
 * rendered), remark-math and rehype-katex. Math is first normalized with the
 * same delimiter rules as <MathText>: \( \), \[ \], $…$ and $$…$$ become
 * remark-math's $$ forms and every other $ is escaped, so prices stay text.
 * This module, KaTeX and its stylesheet load lazily (see Markdown.tsx).
 */

import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { normalizeMathMarkdown } from '../lib/analysis/math'

export default function MarkdownMath({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'markdown ' + (className ?? '')} data-math="true">
      <ReactMarkdown
        remarkPlugins={[[remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false, strict: 'ignore', errorColor: 'var(--color-destructive)' }]]}
      >
        {normalizeMathMarkdown(text)}
      </ReactMarkdown>
    </div>
  )
}
