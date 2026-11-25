/**
 * Maps a paper's concepts to topic keys. The model proposes a topic per
 * concept (an existing key or a new topic). A reuse of an existing topic is
 * accepted only when the concept's name and the topic's name share a content
 * word (sharesContentWord in lib/knowledge/topics); otherwise the concept gets a topic
 * of its own, named for it. New topics are created as proposed, and concepts
 * that share a topic within the paper are split so every concept has its own
 * (see splitSharedTopics).
 */

import { asString } from '../../lib/json'
import { normalizeLevel, normalizeTopicKey, sharesContentWord, splitSharedTopics } from '../../lib/knowledge/topics'
import type { TopicData, TopicLevel } from '../../types'

export interface TopicProposal {
  id: string
  name: string
  whyNeeded: string
  topic: Record<string, unknown>
}

export interface RejectedReuse {
  id: string
  /** The existing topic the model proposed. */
  from: string
  /** The topic the concept got instead. */
  to: string
}

/** Topics listed in the concepts prompt, and how long each description may be there. */
export const MAX_TOPICS_IN_PROMPT = 150
export const TOPIC_DESCRIPTION_CHARS = 80

const LEVEL_RANK: Record<TopicLevel, number> = { foundation: 0, core: 1, specialized: 2 }

/** The vocabulary the concepts call sees: foundation and core topics first, starter topics first within a level. */
export function promptTopics(topics: Pick<TopicData, 'key' | 'name' | 'level' | 'description' | 'origin'>[]) {
  return topics
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        (LEVEL_RANK[a.t.level] ?? 1) - (LEVEL_RANK[b.t.level] ?? 1) ||
        (a.t.origin === b.t.origin ? 0 : a.t.origin === 'starter' ? -1 : 1) ||
        a.i - b.i,
    )
    .slice(0, MAX_TOPICS_IN_PROMPT)
    .map(({ t }) => ({ key: t.key, name: t.name, description: truncate(t.description ?? '', TOPIC_DESCRIPTION_CHARS) }))
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length <= n ? one : `${one.slice(0, n - 1).trimEnd()}…`
}

function newTopic(key: string, name: string, level: TopicLevel, description: string, searchQuery: string): TopicData {
  return {
    key,
    name,
    level,
    description,
    searchQuery,
    resources: [],
    resourcesStatus: 'none',
    resourcesLoadingAt: 0,
    origin: 'paper',
  }
}

export function assignTopics(
  concepts: TopicProposal[],
  existing: Map<string, Pick<TopicData, 'name' | 'level'> & { description?: string }>,
): { topicFor: Record<string, string>; newTopics: Map<string, TopicData>; rejected: RejectedReuse[] } {
  const newTopics = new Map<string, TopicData>()
  const topicFor: Record<string, string> = {}
  const rejected: RejectedReuse[] = []
  for (const c of concepts) {
    if (topicFor[c.id]) continue
    let key = normalizeTopicKey(asString(c.topic.key, 120) || c.name)
    if (!key) key = normalizeTopicKey(c.name) || `topic-${c.id}`
    const found = existing.get(key)
    if (found && !sharesContentWord(c.name, found.name)) {
      // Not the same idea: a topic of its own, named for the concept.
      const own = normalizeTopicKey(c.name) || `topic-${c.id}`
      const ownExisting = existing.get(own)
      const to = !ownExisting || sharesContentWord(c.name, ownExisting.name) ? own : `${own.slice(0, 54).replace(/-+$/, '')}-topic`
      rejected.push({ id: c.id, from: key, to })
      topicFor[c.id] = to
      if (existing.has(to) || newTopics.has(to)) continue
      const proposed = asString(c.topic.description, 400)
      newTopics.set(
        to,
        newTopic(
          to,
          c.name,
          found.level ?? 'core',
          proposed && proposed !== found.description ? proposed : asString(c.whyNeeded, 400),
          `${c.name} explained for beginners`,
        ),
      )
      continue
    }
    topicFor[c.id] = key
    if (found || newTopics.has(key)) continue
    const name = asString(c.topic.name, 120) || c.name
    newTopics.set(
      key,
      newTopic(
        key,
        name,
        normalizeLevel(c.topic.level),
        asString(c.topic.description, 400) || c.whyNeeded,
        asString(c.topic.search_query, 200) || `${name} explained for beginners`,
      ),
    )
  }

  const topicName = (key: string) => existing.get(key)?.name ?? newTopics.get(key)?.name ?? ''
  const claims = concepts.filter((c, i) => concepts.findIndex((d) => d.id === c.id) === i)
  for (const split of splitSharedTopics(claims.map((c) => ({ id: c.id, name: c.name, topicKey: topicFor[c.id] })), topicName)) {
    const c = claims.find((k) => k.id === split.id)!
    topicFor[c.id] = split.to
    if (existing.has(split.to) || newTopics.has(split.to)) continue
    const level = existing.get(split.from)?.level ?? newTopics.get(split.from)?.level ?? 'core'
    newTopics.set(split.to, newTopic(split.to, c.name, level, asString(c.whyNeeded, 400), `${c.name} explained for beginners`))
  }
  // A topic proposed only by concepts that all moved away is not needed.
  const usedKeys = new Set(Object.values(topicFor))
  for (const key of [...newTopics.keys()]) if (!usedKeys.has(key)) newTopics.delete(key)
  return { topicFor, newTopics, rejected }
}
