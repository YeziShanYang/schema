/**
 * One concept: why the paper needs it, the supporting quote, topic resources,
 * the reader's status, a check question and on-demand AI explanation.
 */

import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Badge, Button } from '../ui'
import type { ConceptData, KnowledgeStatus, PaperData, TopicData } from '../../types'
import type { KnowledgeApi } from '../../hooks/useReader'
import { actions } from '../../lib/actions-client'

interface Props {
  concept: RecordData<ConceptData>
  paper: RecordData<PaperData>
  topic: TopicData | undefined
  prerequisites: string[]
  status: KnowledgeStatus | null
  knowledge: KnowledgeApi
  signedIn: boolean
}

export function ConceptCard({ concept, paper, topic, prerequisites, status, knowledge, signedIn }: Props) {
  const c = concept.data
  const from = { paperId: paper.recordId, arxivId: paper.data.arxivId }
  const [choice, setChoice] = useState<number | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState('')
  const answered = choice !== null && c.check
  const correct = answered && choice === c.check!.answerIndex

  async function answer(i: number) {
    setChoice(i)
    if (c.check && i === c.check.answerIndex && signedIn) {
      await knowledge.set(c.topicKey, 'known', 'check', from)
    }
  }

  async function explain() {
    setExplaining(true)
    setExplainError('')
    const r = await actions.explainConcept(concept.recordId)
    setExplaining(false)
    if (!r.success) setExplainError(r.error)
  }

  return (
    <article
      id={`concept-${c.key}`}
      data-testid="concept-card"
      data-concept-key={c.key}
      data-status={status ?? 'unknown'}
      className="rounded-lg border border-border bg-card p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{c.name}</h3>
        <Badge variant="outline">tier {c.tier + 1}</Badge>
        <Badge variant="secondary">{c.depth}</Badge>
        {topic && <Badge variant="outline">{topic.level}</Badge>}
        {status && <Badge variant={status === 'known' ? 'success' : 'info'}>{status}</Badge>}
      </header>
      {topic && topic.name !== c.name && <p className="mt-1 text-xs text-muted-foreground">Topic: {topic.name}</p>}
      <p className="mt-2 text-sm">{c.whyNeeded}</p>
      {c.quote && c.quoteVerified && (
        <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
          “{c.quote}” <span className="not-italic">({c.section})</span>
        </blockquote>
      )}
      {prerequisites.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Learn first: {prerequisites.join(', ')}</p>
      )}

      {topic && topic.resources?.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-testid="concept-resources">
          {topic.resources.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                {r.title}
              </a>
              {r.why && <span className="text-muted-foreground"> — {r.why}</span>}
            </li>
          ))}
        </ul>
      )}

      {signedIn && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="concept-status-controls">
          <Button size="sm" variant={status === 'known' ? 'default' : 'outline'} disabled={!knowledge.ready}
            onClick={() => knowledge.set(c.topicKey, 'known', 'self', from)} data-testid="mark-known">
            I know this
          </Button>
          <Button size="sm" variant={status === 'learning' ? 'default' : 'outline'} disabled={!knowledge.ready}
            onClick={() => knowledge.set(c.topicKey, 'learning', 'paper', from)} data-testid="mark-learning">
            Learning
          </Button>
          <Button size="sm" variant="outline" disabled={!knowledge.ready || status === 'known'}
            onClick={() => knowledge.set(c.topicKey, 'known', 'paper', from)} data-testid="mark-done">
            Done
          </Button>
          {status && (
            <Button size="sm" variant="ghost" disabled={!knowledge.ready} onClick={() => knowledge.clear(c.topicKey)} data-testid="mark-clear">
              Reset
            </Button>
          )}
        </div>
      )}

      {c.check && (
        <details className="mt-3" data-testid="concept-check">
          <summary className="cursor-pointer text-sm font-medium">Check question</summary>
          <p className="mt-2 text-sm">{c.check.question}</p>
          <div className="mt-2 flex flex-col gap-1">
            {c.check.choices.map((ch, i) => (
              <Button key={i} size="sm" variant={choice === i ? (correct ? 'default' : 'destructive') : 'outline'}
                className="justify-start whitespace-normal text-left" onClick={() => answer(i)} data-testid="check-choice">
                {ch}
              </Button>
            ))}
          </div>
          {answered && (
            <p className="mt-2 text-sm" data-testid="check-result">
              {correct ? 'Correct. ' : 'Not quite. '}
              {c.check.explanation}
              {correct && signedIn && ' Marked as known.'}
            </p>
          )}
        </details>
      )}

      <div className="mt-3">
        {c.explanation ? (
          <details open data-testid="concept-explanation">
            <summary className="cursor-pointer text-sm font-medium">AI explanation</summary>
            <div className="mt-2 whitespace-pre-wrap text-sm">{c.explanation}</div>
          </details>
        ) : signedIn ? (
          <Button size="sm" variant="secondary" loading={explaining} onClick={explain} data-testid="explain-button">
            Explain with AI
          </Button>
        ) : null}
        {explainError && <p role="alert" className="mt-1 text-sm text-destructive">{explainError}</p>}
      </div>
    </article>
  )
}
