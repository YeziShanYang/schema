/**
 * One-off: set papers.topicKeys for papers analyzed before the field
 * existed. Safe to re-run; papers that already have topic keys are skipped.
 *
 *   node scripts/backfill-topic-keys.mjs [app]
 */
import { invoke, query } from './agent.mjs'

const app = process.argv[2] ?? 'schema'
for (const p of query(app, 'papers')) {
  if (Array.isArray(p.data.topicKeys) && p.data.topicKeys.length) continue
  const keys = [...new Set(query(app, 'concepts', { paperId: p.recordId }, 500).map((c) => c.data.topicKey).filter(Boolean))]
  if (!keys.length) continue
  invoke(app, 'records_update', { collection: 'papers', recordId: p.recordId, data: { topicKeys: keys } })
  console.log(`${p.data.arxivId}: ${keys.length} topic keys`)
}
