/**
 * One concept: status, why the paper needs it, the verified quote, topic
 * description and explainer links, a check question and the AI explanation.
 * Works with the real knowledge profile or the signed-out demo adapter.
 */

import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Button } from '../ui'
import type { ConceptData, KnowledgeStatus, PaperData, TopicData } from '../../types'
import type { KnowledgeApi } from '../../hooks/useReader'
import { actions } from '../../lib/actions-client'
import { KnownToggle, LearningToggle } from '../StatusControl'
import { Chip } from '../blueprint'
import { ExternalIcon, SparkIcon } from '../icons'
import { cleanTitle, Markdown } from '../Markdown'

interface Props {
  concept: RecordData<ConceptData>
  paper: RecordData<PaperData>
  topic: TopicData | undefined
  prerequisites: { key: string; name: string }[]
  onOpenConcept?: (key: string) => void
  status: KnowledgeStatus | null
  knowledge: KnowledgeApi
  signedIn: boolean
  explainLeft?: number
}

export function ConceptCard({ concept, paper, topic, prerequisites, onOpenConcept, status, knowledge, signedIn, explainLeft }: Props) {
  const c = concept.data
  const from = { paperId: paper.recordId, arxivId: paper.data.arxivId }
  const [choice, setChoice] = useState<number | null>(null)
  const [showCheck, setShowCheck] = useState(false)
  // A cached explanation starts collapsed; one generated now opens right away.
  const [showExplain, setShowExplain] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState('')
  const answered = choice !== null && c.check
  const correct = answered && choice === c.check!.answerIndex

  async function setStatus(next: KnowledgeStatus | null) {
    if (next === null) await knowledge.clear(c.topicKey)
    else await knowledge.set(c.topicKey, next, next === 'known' ? 'self' : 'paper', from)
  }

  async function answer(i: number) {
    setChoice(i)
    if (c.check && i === c.check.answerIndex) await knowledge.set(c.topicKey, 'known', 'check', from)
  }

  async function explain() {
    setExplaining(true)
    setExplainError('')
    const r = await actions.explainConcept(concept.recordId)
    setExplaining(false)
    if (!r.success) setExplainError(r.error)
    else setShowExplain(true)
  }

  return (
    <li
      id={`concept-${c.key}`}
      data-testid="concept-card"
      data-concept-key={c.key}
      data-status={status ?? 'unknown'}
      className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 border-b border-border px-2 py-3.5 last:border-b-0"
    >
      <KnownToggle status={status} name={c.name} disabled={!knowledge.ready} onChange={setStatus} className="mt-px" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className={status === 'known' ? 'font-semibold leading-snug text-muted-foreground' : 'font-semibold leading-snug'}>{c.name}</span>
          <Chip tone={c.depth === 'deep' ? 'accent' : 'plain'}>{c.depth}</Chip>
        </div>

        <div className="mt-1.5">
          <LearningToggle status={status} name={c.name} disabled={!knowledge.ready} onChange={setStatus} />
        </div>

        {prerequisites.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="label">Learn first</span>
            {prerequisites.map((p) => (
              <button key={p.key} type="button" onClick={() => onOpenConcept?.(p.key)} className="press cursor-pointer rounded-[3px] bg-surface-2 px-1.5 py-0.5 text-xs text-foreground border border-border hover:bg-accent-soft">
                {p.name}
              </button>
            ))}
          </p>
        )}

        <p className="mb-2 mt-1.5 text-[13px] leading-[1.45] text-muted-foreground">{c.whyNeeded}</p>
        {topic?.description && <p className="mb-2 text-xs text-faint">Topic: {topic.name}. {topic.description}</p>}

        {c.quote && c.quoteVerified && (
          <blockquote className="mb-2.5 rounded-r border-l-2 border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-muted-foreground">
            “{c.quote}”
            <cite className="label mt-1 block not-italic text-faint">{c.section}</cite>
          </blockquote>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {topic?.resourcesStatus === 'ready' && topic.resources?.length > 0 && (
            <ul className="flex w-full flex-col gap-1.5" data-testid="concept-resources">
              {topic.resources.map((r) => (
                <li key={r.url} className="text-[12.5px]">
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface-2 px-2 py-1 text-foreground transition-[background-color] duration-150 hover:bg-accent-soft">
                    <span className="truncate">{cleanTitle(r.title)}</span>
                    <ExternalIcon size={13} className="shrink-0" />
                  </a>
                  {r.why && <p className="mt-0.5 pl-0.5 text-xs text-muted-foreground">{r.why}</p>}
                </li>
              ))}
            </ul>
          )}
          {topic?.resourcesStatus === 'loading' && <span className="text-xs text-muted-foreground" data-testid="concept-links-loading">Finding explainers…</span>}
          {topic?.resourcesStatus === 'failed' && <span className="text-xs text-faint">No explainers found for this topic.</span>}

          {c.explanation ? (
            <button type="button" aria-expanded={showExplain} onClick={() => setShowExplain((v) => !v)} data-testid="explain-toggle" className="press inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[12.5px] font-medium text-primary hover:bg-accent-soft">
              <SparkIcon size={13} /> {showExplain ? 'Hide explanation' : 'Show explanation'}
            </button>
          ) : signedIn ? (
            <Button size="sm" variant="ghost" className="text-primary" loading={explaining} onClick={explain} data-testid="explain-button">
              <SparkIcon size={13} /> Explain with AI
              {explainLeft !== undefined && <span className="font-normal text-faint tabular-nums">· {explainLeft} left today</span>}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 text-[12.5px] text-faint" data-testid="explain-signin">
              <SparkIcon size={13} /> Sign in to generate an AI explanation
            </span>
          )}

          {c.check && (
            <button type="button" aria-expanded={showCheck} onClick={() => setShowCheck((v) => !v)} className="press inline-flex cursor-pointer items-center rounded px-1.5 py-1 text-[12.5px] font-medium text-foreground hover:bg-accent" data-testid="check-toggle">
              Check yourself
            </button>
          )}
        </div>
        {explainError && <p role="alert" className="mt-1 text-xs text-destructive">{explainError}</p>}

        {c.explanation && showExplain && (
          <div className="reveal mt-2.5 rounded bg-accent-soft px-3 py-2.5 text-[13px] leading-normal" data-testid="concept-explanation">
            <span className="label mb-1 block text-primary">Explained for this paper</span>
            <Markdown text={c.explanation} />
          </div>
        )}

        {c.check && showCheck && (
          <div className="mt-2.5 border-t border-border pt-3" data-testid="concept-check">
            <p className="text-sm font-medium">{c.check.question}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {c.check.choices.map((ch, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => answer(i)}
                  data-testid="check-choice"
                  aria-pressed={choice === i}
                  className={
                    'press cursor-pointer rounded border px-2.5 py-1.5 text-left text-[13px] ' +
                    (choice === i
                      ? correct
                        ? 'border-known bg-[color-mix(in_oklab,var(--color-known)_10%,white)]'
                        : 'border-destructive bg-[color-mix(in_oklab,var(--color-destructive)_8%,white)]'
                      : 'border-border bg-card hover:bg-accent')
                  }
                >
                  {ch}
                </button>
              ))}
            </div>
            {answered && (
              <p className="mt-2 text-[13px]" data-testid="check-result">
                <b className={correct ? 'text-known' : 'text-destructive'}>{correct ? 'Correct. ' : 'Not quite. '}</b>
                {c.check.explanation}
                {correct && ' Marked as known.'}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
