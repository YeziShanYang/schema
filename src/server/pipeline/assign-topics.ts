/**
 * Maps a paper's concepts to topic keys. The model proposes a topic per
 * concept (an existing key or a new topic). New topics are created as
 * proposed, and concepts that share a topic within the paper are split so
 * every concept has its own (see splitSharedTopics).
 */

import { asString } from '../../lib/json'
import { normalizeLevel, normalizeTopicKey, splitSharedTopics } from '../../lib/topics'
import type { TopicData, TopicLevel } from '../../types'

export interface TopicProposal {
  id: string
  name: string
  whyNeeded: string
  topic: Record<string, unknown>
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
  existing: Map<string, Pick<TopicData, 'name' | 'level'>>,
): { topicFor: Record<string, string>; newTopics: Map<string, TopicData> } {
  const newTopics = new Map<string, TopicData>()
  const topicFor: Record<string, string> = {}
  for (const c of concepts) {
    if (topicFor[c.id]) continue
    let key = normalizeTopicKey(asString(c.topic.key, 120) || c.name)
    if (!key) key = normalizeTopicKey(c.name) || `topic-${c.id}`
    topicFor[c.id] = key
    if (existing.has(key) || newTopics.has(key)) continue
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
  return { topicFor, newTopics }
}
