/**
 * Agent tools for the app owner's maintenance, next to the record tools in
 * tools.ts. Any other caller is refused. The owner starts them from the CLI:
 *
 *   npx deepspace agent invoke schema <tool> --input-file input.json --json
 *
 * `reanalyze_paper` re-runs the analysis of one paper with the current
 * pipeline (see src/server/reanalyze.ts), with {"arxivId": "1706.03762"}.
 *
 * `save_requested_papers` saves every paper a reader requested in that
 * reader's Library, for analyses started before a new analysis did so (see
 * saveRequestedPapers in src/server/library.ts). It is a dry run unless the
 * input is {"dryRun": false}.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import type { AgentToolContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, PaperData } from '../types'
import { parseArxivId } from '../lib/arxiv'
import { ownerContext } from '../server/pipeline/client'
import { isOwner, startReanalysis } from '../server/reanalyze'
import { recordToolsAs } from '../server/action-routes'
import { saveRequestedPapers } from '../server/library'

export function ownerTools(context: AgentToolContext<Env>): ToolSet {
  return {
    reanalyze_paper: tool({
      description:
        'App owner only. Re-analyze one paper with the current pipeline: resets it, clears its concepts and sections, runs the analysis again and moves readers\' checkmarks to the new concepts. Returns at once; poll the papers record until status is ready.',
      inputSchema: jsonSchema<{ arxivId: string }>({
        type: 'object',
        properties: { arxivId: { type: 'string', description: 'arXiv id or link, e.g. 1706.03762' } },
        required: ['arxivId'],
        additionalProperties: false,
      }),
      execute: async ({ arxivId }) => {
        const { env, userId } = context
        if (!isOwner(env, userId)) return { success: false, error: 'Only the app owner can re-analyze a paper.' }
        const ref = parseArxivId(String(arxivId ?? ''))
        if (!ref) return { success: false, error: 'That is not an arXiv id.' }
        const records = ownerContext(env).records
        const [paper] = (await records.query('papers', { where: { arxivId: ref.id }, limit: 1 })) as Envelope<PaperData>[]
        if (!paper) return { success: false, error: `Paper ${ref.id} not found.` }
        const r = await startReanalysis(env, userId, paper, (id, data) => records.update('papers', id, data))
        return r.ok ? { success: true, data: { paperId: r.paperId, arxivId: r.arxivId, status: 'queued' } } : { success: false, error: r.error }
      },
    }),

    save_requested_papers: tool({
      description:
        "App owner only. For every counted analyze usage event whose paper exists, saves that paper in the Library of the reader who requested it, but only when the reader's roadmaps row for it has no savedAt (or there is no row; one is created with lastOpenedAt 0, so it stays out of Recent papers). Papers a reader saved already or removed (savedAt 0) are left alone, so a second run changes nothing. A dry run unless dryRun is false: it reports the counts and up to 50 of the saves it would make.",
      inputSchema: jsonSchema<{ dryRun?: boolean }>({
        type: 'object',
        properties: { dryRun: { type: 'boolean', description: 'Report what would change without writing. Defaults to true; pass false to save.' } },
        additionalProperties: false,
      }),
      execute: async ({ dryRun }) => {
        const { env, userId } = context
        if (!isOwner(env, userId)) return { success: false, error: 'Only the app owner can save requested papers.' }
        // Reads go through the owner's tools; each save is written as its reader, who then owns the row.
        const data = await saveRequestedPapers(recordToolsAs(env, userId), (reader) => recordToolsAs(env, reader), { dryRun: dryRun !== false })
        return { success: true, data }
      },
    }),
  }
}
