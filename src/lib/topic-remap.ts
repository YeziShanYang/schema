/**
 * The migration for the topic-reuse rule (scripts/remap-topics.mjs): papers
 * analyzed before the rule existed may map a concept to a broader topic
 * ("BLEU score" to "Evaluation metrics"). Each concept whose name shares no
 * content word with its topic's name moves to a topic named for the concept,
 * the same key the analyze job would give it now.
 */

import { normalizeTopicKey, sharesContentWord } from './topics.ts'

export interface RemapConceptInput {
  id: string
  name: string
  topicKey: string
}

export interface TopicMove {
  id: string
  from: string
  to: string
}

/**
 * Moves for one paper. `topicName` gives an existing topic's name ('' when
 * there is none). A target key whose existing topic is a different idea gets
 * a "-topic" suffix, and a key another concept of the paper already holds
 * gets a numeric one, so every concept keeps its own topic.
 */
export function planTopicMoves(concepts: RemapConceptInput[], topicName: (key: string) => string): TopicMove[] {
  const taken = new Set(concepts.map((c) => c.topicKey))
  const moves: TopicMove[] = []
  for (const c of concepts) {
    const current = topicName(c.topicKey)
    if (!current || sharesContentWord(c.name, current)) continue
    let to = normalizeTopicKey(c.name) || `topic-${normalizeTopicKey(c.id) || 'concept'}`
    const there = topicName(to)
    if (there && !sharesContentWord(c.name, there)) to = `${to.slice(0, 54).replace(/-+$/, '')}-topic`
    const base = to
    for (let n = 2; taken.has(to) && to !== c.topicKey; n++) to = `${base.slice(0, 56).replace(/-+$/, '')}-${n}`
    if (to === c.topicKey) continue
    taken.add(to)
    moves.push({ id: c.id, from: c.topicKey, to })
  }
  return moves
}
