/**
 * Re-keys concepts that share a topic within one paper, for papers analyzed
 * before the analyze job enforced one topic per concept. Applies the same
 * rule as the job (splitSharedTopics in src/lib/knowledge/topics.ts): the concept whose
 * name best matches the topic keeps it, and each other concept moves to a
 * topic named after itself, created if missing. Then the paper's topicKeys
 * are recomputed. Prints the plan; --apply writes it. Safe to re-run.
 *
 *   node scripts/migrations/split-shared-topics.mjs [app] [--apply]
 *
 * Readers' knowledge rows for the shared topic are left as they are, so a
 * re-keyed concept starts unmarked.
 */
import { conceptsOf, invoke, query } from '../agent.mjs'
import { splitSharedTopics } from '../../src/lib/knowledge/topics.ts'

const app = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'schema'
const apply = process.argv.includes('--apply')

const topicCache = new Map()
function topic(key) {
  if (!topicCache.has(key)) topicCache.set(key, query(app, 'topics', { key }, 1)[0] ?? null)
  return topicCache.get(key)
}

let moves = 0
for (const paper of query(app, 'papers')) {
  if (paper.data.status !== 'ready') continue
  const concepts = conceptsOf(app, paper).sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
  const splits = splitSharedTopics(
    concepts.map((c) => ({ id: c.data.key, name: c.data.name, topicKey: c.data.topicKey })),
    (key) => topic(key)?.data.name ?? '',
  )
  if (!splits.length) {
    console.log(`${paper.data.arxivId}: no shared topics`)
    continue
  }
  for (const s of splits) {
    const c = concepts.find((k) => k.data.key === s.id)
    const exists = topic(s.to)
    console.log(`${paper.data.arxivId}: ${s.id} "${c.data.name}" ${s.from} -> ${s.to}${exists ? ' (existing topic)' : ' (new topic)'}`)
    moves++
    if (!apply) continue
    if (!exists) {
      invoke(app, 'records_create', {
        collection: 'topics',
        data: {
          key: s.to,
          name: c.data.name,
          level: topic(s.from)?.data.level ?? 'core',
          description: (c.data.whyNeeded ?? '').slice(0, 400),
          searchQuery: `${c.data.name} explained for beginners`,
          resources: [],
          resourcesStatus: 'none',
          resourcesLoadingAt: 0,
          origin: 'paper',
        },
      })
      topicCache.delete(s.to)
    }
    invoke(app, 'records_update', { collection: 'concepts', recordId: c.recordId, data: { topicKey: s.to } })
    c.data.topicKey = s.to
  }
  if (apply) {
    const keys = [...new Set(concepts.map((c) => c.data.topicKey).filter(Boolean))]
    invoke(app, 'records_update', { collection: 'papers', recordId: paper.recordId, data: { topicKeys: keys } })
    console.log(`${paper.data.arxivId}: ${concepts.length} concepts, ${keys.length} topic keys`)
  }
}
console.log(apply ? `Applied ${moves} moves.` : `${moves} moves planned. Re-run with --apply to write them.`)
