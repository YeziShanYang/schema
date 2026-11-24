/**
 * Hints for a concept the reader has not checked in this paper. Checking a
 * concept never checks anything in another paper; instead, a concept gets a
 * muted note in two cases:
 * - "You checked this in <paper>": the reader checked a concept in another
 *   paper with the same topic key or the same normalized name.
 * - "In your profile": the concept's topic is a self-declared profile topic.
 * A checked concept elsewhere wins over the profile, since it names a paper.
 * Topic keys are compared as stored: the strict reuse rule is applied when
 * the analyze job assigns topics. Names use normalizeConceptName, the same
 * folding the re-analysis remap uses (src/lib/topics.ts).
 */

import { normalizeConceptName } from './topics'

export interface CheckedConcept {
  conceptId: string
  paperId: string
  arxivId: string
  conceptName: string
  topicKey: string
}

export type ConceptHint =
  | { kind: 'checked'; paperId: string; arxivId: string; conceptName: string }
  | { kind: 'profile'; topicKey: string }

export interface HintIndex {
  byTopic: Map<string, CheckedConcept[]>
  byName: Map<string, CheckedConcept[]>
  profile: Set<string>
}

function push(m: Map<string, CheckedConcept[]>, key: string, row: CheckedConcept) {
  if (!key) return
  const list = m.get(key)
  if (list) list.push(row)
  else m.set(key, [row])
}

/** Rows keep their order, so the first row of a match (for example the most recent) names the paper. */
export function buildHintIndex(checked: CheckedConcept[], profileTopics: Iterable<string>): HintIndex {
  const byTopic = new Map<string, CheckedConcept[]>()
  const byName = new Map<string, CheckedConcept[]>()
  for (const row of checked) {
    push(byTopic, row.topicKey, row)
    push(byName, normalizeConceptName(row.conceptName), row)
  }
  return { byTopic, byName, profile: new Set([...profileTopics].filter(Boolean)) }
}

export function conceptHint(
  index: HintIndex,
  concept: { conceptId: string; paperId: string; name: string; topicKey: string },
): ConceptHint | null {
  const elsewhere = (rows: CheckedConcept[] | undefined) =>
    rows?.find((r) => r.paperId !== concept.paperId && r.conceptId !== concept.conceptId)
  const name = normalizeConceptName(concept.name)
  const match = (concept.topicKey ? elsewhere(index.byTopic.get(concept.topicKey)) : undefined) ?? (name ? elsewhere(index.byName.get(name)) : undefined)
  if (match) return { kind: 'checked', paperId: match.paperId, arxivId: match.arxivId, conceptName: match.conceptName }
  if (concept.topicKey && index.profile.has(concept.topicKey)) return { kind: 'profile', topicKey: concept.topicKey }
  return null
}

/** The note's text; `title` is the other paper's title when known. */
export function hintText(hint: ConceptHint, title?: string): string {
  return hint.kind === 'profile' ? 'In your profile' : `You checked this in ${title || `arXiv ${hint.arxivId}`}`
}
