/**
 * One concept: its checkmark, why the paper needs it, the verified quote,
 * topic description and explainer links, and the AI explanation. A concept
 * not checked here can carry a muted note: checked in another paper, or in
 * the reader's profile. Works with the real rows or the signed-out demo adapter.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { RecordData } from 'deepspace'
import { cn } from '@/lib/utils'
import { Button } from '../ui'
import type { ConceptData, KnowledgeStatus, PaperData, TopicData } from '../../types'
import type { ReaderKnowledgeApi } from '../../hooks/useDemoKnowledge'
import { actions } from '../../lib/actions-client'
import { arxivSlug } from '../../lib/arxiv'
import { hintText, type ConceptHint } from '../../lib/hints'
import { linkTitle } from '../../lib/links'
import { ConceptName, MathText } from '../MathText'
import { KnownToggle } from '../StatusControl'
import { Chip } from '../blueprint'
import { CheckIcon, ExternalIcon, SparkIcon } from '../icons'
import { cleanTitle, Markdown } from '../Markdown'

interface Props {
  concept: RecordData<ConceptData>
  paper: RecordData<PaperData>
  topic: TopicData | undefined
  prerequisites: { key: string; name: string }[]
  onOpenConcept?: (key: string) => void
  /** Opens the paper overview with this concept highlighted. */
  onSeeInOverview?: () => void
  status: KnowledgeStatus | null
  knowledge: Pick<ReaderKnowledgeApi, 'ready' | 'isPending' | 'set' | 'clear'>
  /** Shown only while the concept is not checked here. */
  hint?: ConceptHint | null
  /** Title of the paper a `checked` hint points to, when known. */
  hintTitle?: string
  signedIn: boolean
  explainLeft?: number
  /** Branch-level link state for topics that have no links yet. */
  linksState?: 'loading' | 'signin' | null
  onSignIn?: () => void
  /** Position within the branch in the recommended sequence. */
  stepIndex?: number
  nextUp?: boolean
}

export function ConceptCard({ concept, paper, topic, prerequisites, onOpenConcept, onSeeInOverview, status, knowledge, hint, hintTitle, signedIn, explainLeft, linksState, onSignIn, stepIndex, nextUp }: Props) {
  const c = concept.data
  // A cached explanation starts collapsed; one generated now opens right away.
  const [showExplain, setShowExplain] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState('')
  // A loading mark older than 5 minutes is stale (see branchLinkState): the topic just has no links yet.
  const linksLoading = topic?.resourcesStatus === 'loading' && Date.now() - (topic.resourcesLoadingAt || 0) < 5 * 60 * 1000
  const noLinks = !topic?.resourcesStatus || topic.resourcesStatus === 'none' || (topic.resourcesStatus === 'loading' && !linksLoading)
  // A paper-only topic gets no web search; its card leads with the AI explanation instead.
  const skipped = topic?.resourcesStatus === 'skipped'
  const note = status !== 'known' && hint ? hint : null

  async function setStatus(next: KnowledgeStatus | null) {
    if (next === null) await knowledge.clear(concept.recordId)
    else
      await knowledge.set(
        { conceptId: concept.recordId, paperId: paper.recordId, arxivId: paper.data.arxivId, conceptName: c.name, topicKey: c.topicKey },
        'self',
      )
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
      data-concept-id={concept.recordId}
      data-status={status ?? 'unknown'}
      data-next-up={nextUp ? 'true' : undefined}
      className={
        'status-surface grid scroll-mt-4 grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-lg border bg-card p-3.5 ' +
        (status === 'known' ? 'known-outline' : nextUp ? 'border-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'border-border')
      }
    >
      <KnownToggle status={status} name={c.name} disabled={!knowledge.ready || knowledge.isPending(concept.recordId)} onChange={setStatus} className="mt-px" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2.5">
          <span className={status === 'known' ? 'font-semibold leading-snug text-muted-foreground' : 'font-semibold leading-snug'}>
            {stepIndex !== undefined && <span className="mr-1.5 font-mono text-[11px] font-normal text-faint tabular-nums">{stepIndex}.</span>}
            <ConceptName name={c.name} />
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {nextUp && <Chip tone="accent"><span data-testid="next-up-badge">Next up</span></Chip>}
            <Chip tone={c.depth === 'deep' ? 'accent' : 'plain'}>{c.depth}</Chip>
          </span>
        </div>

        {note && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" data-testid="concept-hint" data-hint={note.kind}>
            <CheckIcon size={12} className="shrink-0 text-faint" aria-hidden="true" />
            {note.kind === 'checked' ? (
              <span>
                You checked this in{' '}
                <Link to={`/p/${arxivSlug(note.arxivId)}`} className="text-foreground hover:text-primary hover:underline">
                  {hintTitle || `arXiv ${note.arxivId}`}
                </Link>
              </span>
            ) : (
              <span>{hintText(note)}</span>
            )}
          </p>
        )}

        {c.plainRole && (
          <p className="mt-1.5 text-[13px] leading-[1.45]" data-testid="concept-role">
            <span className="label mr-1.5">Where it fits</span>
            <MathText text={c.plainRole} />
            {onSeeInOverview && (
              <>
                {' '}
                <button type="button" onClick={onSeeInOverview} className="cursor-pointer whitespace-nowrap font-medium text-primary hover:underline" data-testid="see-in-overview">
                  See in overview
                </button>
              </>
            )}
          </p>
        )}

        {prerequisites.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="label">Learn first</span>
            {prerequisites.map((p) => (
              <button key={p.key} type="button" onClick={() => onOpenConcept?.(p.key)} className="press cursor-pointer rounded-[3px] bg-surface-2 px-1.5 py-0.5 text-xs text-foreground border border-border hover:bg-accent-soft">
                <ConceptName name={p.name} />
              </button>
            ))}
          </p>
        )}

        <p className="mb-2 mt-1.5 text-[13px] leading-[1.45] text-muted-foreground"><MathText text={c.whyNeeded} /></p>
        {topic?.description && <p className="mb-2 text-xs text-faint">Topic: {topic.name}. {topic.description}</p>}

        {c.quote && c.quoteVerified && (
          <blockquote className="mb-2.5 rounded-r border-l-2 border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-muted-foreground">
            {/* quote stays verbatim for verification; quoteDisplay is the same sentence with its math as LaTeX. */}
            “{c.quoteDisplay ? <MathText text={c.quoteDisplay} /> : c.quote}”
            <cite className="label mt-1 block not-italic text-faint">{c.section}</cite>
          </blockquote>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {topic?.resourcesStatus === 'ready' && topic.resources?.length > 0 && (
            <ul className="flex w-full flex-col gap-1.5" data-testid="concept-resources">
              {topic.resources.map((r) => (
                <li key={r.url} className="text-[12.5px]">
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface-2 px-2 py-1 text-foreground transition-[background-color] duration-150 hover:bg-accent-soft">
                    <span className="truncate">{cleanTitle(linkTitle(r.title, r.url))}</span>
                    <ExternalIcon size={13} className="shrink-0" />
                  </a>
                  {r.why && <p className="mt-0.5 pl-0.5 text-xs text-muted-foreground">{r.why}</p>}
                </li>
              ))}
            </ul>
          )}
          {(linksLoading || (linksState === 'loading' && noLinks)) && (
            <span className="w-full text-xs text-muted-foreground motion-safe:animate-pulse" data-testid="concept-links-loading">Finding explainer links…</span>
          )}
          {linksState === 'signin' && noLinks && (
            <span className="w-full text-xs text-muted-foreground" data-testid="links-signin">
              <button type="button" onClick={onSignIn} className="text-primary hover:underline">Sign in</button> to load links
            </span>
          )}
          {topic?.resourcesStatus === 'failed' && <span className="text-xs text-faint">No explainers found for this topic.</span>}
          {skipped && (
            <span className="w-full text-xs text-faint" data-testid="links-skipped">
              This idea is specific to this paper, so Schema doesn't search the web for explainers.
            </span>
          )}

          {c.explanation ? (
            <button type="button" aria-expanded={showExplain} onClick={() => setShowExplain((v) => !v)} data-testid="explain-toggle" className={cn('press inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[12.5px] font-medium text-primary hover:bg-accent-soft', skipped && 'order-first')}>
              <SparkIcon size={13} /> {showExplain ? 'Hide explanation' : 'Show explanation'}
            </button>
          ) : signedIn ? (
            <Button size="sm" variant={skipped ? 'outline' : 'ghost'} className={cn('text-primary', skipped && 'order-first')} loading={explaining} onClick={explain} data-testid="explain-button">
              <SparkIcon size={13} /> Explain with AI
              {explainLeft !== undefined && <span className="font-normal text-faint tabular-nums">· {explainLeft} left today</span>}
            </Button>
          ) : (
            <button type="button" onClick={onSignIn} className={cn('press inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[12.5px] font-medium text-primary hover:bg-accent-soft', skipped && 'order-first')} data-testid="explain-signin">
              <SparkIcon size={13} /> Sign in to generate an AI explanation
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

      </div>
    </li>
  )
}
