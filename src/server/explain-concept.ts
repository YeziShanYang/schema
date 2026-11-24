/**
 * "Explain with AI" for one concept: one Haiku call that explains the concept
 * in the context of its paper, with a small worked example. The result is
 * cached on the concept, so every later reader gets it without a model call.
 */

import { appFiles } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ConceptData, Envelope, PaperData } from '../types'
import { createPipelineClient, fixturesAllowed } from './pipeline/client'
import { callModelText } from './pipeline/llm'
import { EXPLAIN_CONCEPT_SYSTEM, explainConceptUser } from './pipeline/prompts'

const EXCERPT_RADIUS = 1200
const MAX_EXPLANATION_CHARS = 6000

/** Text around the concept's quote, or the start of its section, from the stored paper text. */
export function excerptAround(text: string, quote: string, section: string): string {
  if (!text) return ''
  const probes = [quote.slice(0, 60), quote.slice(Math.max(0, quote.length - 60)), section]
  for (const probe of probes) {
    const p = probe.trim()
    if (p.length < 12) continue
    const i = text.indexOf(p)
    if (i !== -1) return text.slice(Math.max(0, i - EXCERPT_RADIUS), i + p.length + EXCERPT_RADIUS)
  }
  return ''
}

export async function generateExplanation(
  env: Env,
  concept: Envelope<ConceptData>,
  paper: Envelope<PaperData>,
): Promise<string> {
  const fixtures = fixturesAllowed(env, paper.data.arxivId)
  let excerpt = ''
  if (paper.data.textKey && !fixtures) {
    try {
      const res = await appFiles(env, { scope: 'app', userId: env.OWNER_USER_ID }).download(paper.data.textKey)
      excerpt = excerptAround(await res.text(), concept.data.quote, concept.data.section)
    } catch {
      excerpt = ''
    }
  }
  const client = createPipelineClient(env, fixtures)
  const text = await callModelText(client, {
    system: EXPLAIN_CONCEPT_SYSTEM,
    user: explainConceptUser({
      paperTitle: paper.data.title,
      mainContribution: paper.data.mainContribution,
      name: concept.data.name,
      whyNeeded: concept.data.whyNeeded,
      section: concept.data.section,
      quote: concept.data.quote,
      excerpt,
    }),
    maxTokens: 4000,
    hint: 'explain-concept',
  })
  return text.trim().slice(0, MAX_EXPLANATION_CHARS)
}
