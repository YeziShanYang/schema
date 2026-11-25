/**
 * Clears explainer links stored under an older fallback rule. When the pick
 * call failed, branch loads used to store raw search results whose title
 * shared one content word with the topic's name, with no "why" line. The
 * rule now asks for two shared content words (fallbackTitleFits in
 * src/lib/links.ts). This finds topics holding a link with no "why" line
 * that fails that rule, and resets them (no links, status "none") so the
 * next branch load searches and picks again. Links the model picked (with a
 * "why" line) never count against a topic. Prints the plan; --apply writes
 * it. Safe to re-run.
 *
 *   node scripts/clear-fallback-links.mjs [app] [--apply]
 *
 * A cleared topic costs one search and part of one pick call the next time
 * a reader loads links for a branch that uses it.
 */
import { invoke, query } from './agent.mjs'
import { failingFallbackLinks } from '../src/lib/links.ts'

const app = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'schema'
const apply = process.argv.includes('--apply')

let cleared = 0
let checked = 0
for (const topic of query(app, 'topics', undefined, 5000)) {
  const links = Array.isArray(topic.data.resources) ? topic.data.resources : []
  if (!links.length) continue
  checked++
  const failing = failingFallbackLinks(topic.data.name ?? '', links)
  if (!failing.length) continue
  cleared++
  console.log(`${topic.data.key} ("${topic.data.name}", ${topic.data.resourcesStatus}): ${links.length} links, ${failing.length} fail the title rule`)
  for (const l of links) console.log(`  ${failing.includes(l) ? 'fails' : 'ok   '} ${l.title} <${l.url}>${l.why ? ` why: ${l.why}` : ' (no why line)'}`)
  if (apply) {
    invoke(app, 'records_update', { collection: 'topics', recordId: topic.recordId, data: { resources: [], resourcesStatus: 'none', resourcesLoadingAt: 0 } })
  }
}
console.log(
  apply
    ? `Cleared ${cleared} of ${checked} topics with links.`
    : `${cleared} of ${checked} topics with links would be cleared. Re-run with --apply to write it.`,
)
