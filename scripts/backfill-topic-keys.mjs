/**
 * Set papers.topicKeys and conceptCount from the stored concepts, for papers
 * analyzed before topicKeys existed. Safe to re-run; --force rewrites papers
 * that already have topic keys.
 *
 *   node scripts/backfill-topic-keys.mjs [app] [--force]
 */
import { conceptsOf, invoke, query } from './agent.mjs'

const app = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'schema'
const force = process.argv.includes('--force')
for (const p of query(app, 'papers')) {
  if (p.data.status !== 'ready') continue
  if (!force && Array.isArray(p.data.topicKeys) && p.data.topicKeys.length) continue
  const concepts = conceptsOf(app, p)
  const keys = [...new Set(concepts.map((c) => c.data.topicKey).filter(Boolean))]
  if (!keys.length) continue
  invoke(app, 'records_update', { collection: 'papers', recordId: p.recordId, data: { topicKeys: keys, conceptCount: concepts.length } })
  console.log(`${p.data.arxivId}: ${concepts.length} concepts, ${keys.length} topic keys`)
}
