/**
 * Exports a trimmed, static snapshot of one analyzed paper for the landing
 * page (src/data/demo-snapshot.json): metadata, branches with their concepts,
 * one explainer link per topic, and any cached AI explanations. Reads the
 * deployed app's public collections through the owner's agent tools.
 *
 *   node scripts/export-demo-snapshot.mjs [arxivId] [app]
 */
import { writeFileSync } from 'node:fs'
import { conceptsOf, query } from './agent.mjs'

const arxivId = process.argv[2] ?? '1706.03762'
const app = process.argv[3] ?? 'schema'

const [paper] = query(app, 'papers', { arxivId }, 1)
if (!paper || paper.data.status !== 'ready') throw new Error(`${arxivId} is not analyzed (status ${paper?.data.status ?? 'missing'})`)
const concepts = conceptsOf(app, paper).sort((a, b) => a.data.tier - b.data.tier || a.data.order - b.data.order)
const topicKeys = new Set(concepts.map((c) => c.data.topicKey))
// One query per key: the agent tool caps how many rows a single query returns.
const topics = Object.fromEntries(
  [...topicKeys]
    .map((key) => query(app, 'topics', { key }, 1)[0])
    .filter(Boolean)
    .map((t) => [t.data.key, { name: t.data.name, level: t.data.level, description: t.data.description, resource: (t.data.resources ?? [])[0] ?? null }]),
)

const snapshot = {
  note: `Real pipeline output for arXiv ${arxivId}, exported by scripts/export-demo-snapshot.mjs.`,
  exportedAt: new Date().toISOString().slice(0, 10),
  paper: {
    arxivId,
    title: paper.data.title,
    authors: (paper.data.authors ?? []).slice(0, 8),
    year: (paper.data.publishedAt ?? '').slice(0, 4),
    mainContribution: paper.data.mainContribution,
  },
  branches: (paper.data.branches ?? []).map((b) => ({
    key: b.key,
    name: b.name,
    description: b.description,
    concepts: concepts
      .filter((c) => c.data.branchKey === b.key)
      .map((c) => ({
        key: c.data.key,
        name: c.data.name,
        depth: c.data.depth,
        tier: c.data.tier,
        whyNeeded: c.data.whyNeeded,
        quote: c.data.quoteVerified ? c.data.quote : '',
        section: c.data.section,
        topicKey: c.data.topicKey,
        explanation: c.data.explanation || '',
      })),
  })),
  topics,
}
const out = new URL('../src/data/demo-snapshot.json', import.meta.url)
writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n')
console.log(`wrote ${out.pathname}: ${snapshot.branches.length} branches, ${concepts.length} concepts, ${Object.keys(topics).length} topics`)
