/**
 * Applies the topic-reuse rule to papers analyzed before it existed
 * (pipelineVersion below 2). A concept whose name shares no content word with
 * its topic's name ("BLEU score" on "Evaluation metrics") moves to a topic
 * named for the concept, created if missing, using the same rule as the
 * analyze job (planTopicMoves in src/lib/knowledge/topic-remap.ts). Then the paper's
 * topicKeys are recomputed. Prints the plan; --apply writes it. Safe to re-run.
 *
 *   node scripts/migrations/remap-topics.mjs [app] [--apply]
 *
 * Papers re-analyzed with the current pipeline are skipped: the job already
 * applies the rule. Readers' checkmarks are per concept, so a move does not
 * change what anyone has checked; the topic only decides shared links and hints.
 */
import { conceptsOf, invoke, query } from '../agent.mjs'
import { planTopicMoves } from '../../src/lib/knowledge/topic-remap.ts'

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
  if ((paper.data.pipelineVersion ?? 1) >= 2) {
    console.log(`${paper.data.arxivId}: analyzed with pipeline ${paper.data.pipelineVersion}, skipped`)
    continue
  }
  const concepts = conceptsOf(app, paper).sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
  const plan = planTopicMoves(
    concepts.map((c) => ({ id: c.data.key, name: c.data.name, topicKey: c.data.topicKey })),
    (key) => topic(key)?.data.name ?? '',
  )
  if (!plan.length) {
    console.log(`${paper.data.arxivId}: every topic fits its concept`)
    continue
  }
  for (const m of plan) {
    const c = concepts.find((k) => k.data.key === m.id)
    const exists = topic(m.to)
    console.log(`${paper.data.arxivId}: ${m.id} "${c.data.name}" ${m.from} ("${topic(m.from)?.data.name}") -> ${m.to}${exists ? ' (existing topic)' : ' (new topic)'}`)
    moves++
    if (!apply) continue
    if (!exists) {
      invoke(app, 'records_create', {
        collection: 'topics',
        data: {
          key: m.to,
          name: c.data.name,
          level: topic(m.from)?.data.level ?? 'core',
          description: (c.data.whyNeeded ?? '').slice(0, 400),
          searchQuery: `${c.data.name} explained for beginners`,
          resources: [],
          resourcesStatus: 'none',
          resourcesLoadingAt: 0,
          origin: 'paper',
        },
      })
      topicCache.delete(m.to)
    }
    invoke(app, 'records_update', { collection: 'concepts', recordId: c.recordId, data: { topicKey: m.to } })
    c.data.topicKey = m.to
  }
  if (apply) {
    const keys = [...new Set(concepts.map((c) => c.data.topicKey).filter(Boolean))]
    invoke(app, 'records_update', { collection: 'papers', recordId: paper.recordId, data: { topicKeys: keys } })
    console.log(`${paper.data.arxivId}: ${concepts.length} concepts, ${keys.length} topic keys`)
  }
}
console.log(apply ? `Applied ${moves} moves.` : `${moves} moves planned. Re-run with --apply to write them.`)
