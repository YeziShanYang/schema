/**
 * Agent tools for the app owner's maintenance, next to the record tools in
 * tools.ts. `reanalyze_paper` re-runs the analysis of one paper with the
 * current pipeline (see src/server/reanalyze.ts), so the owner can start it
 * from the CLI:
 *
 *   npx deepspace agent invoke schema reanalyze_paper --input-file input.json --json
 *
 * with {"arxivId": "1706.03762"}. Any other caller is refused.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import type { AgentToolContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, PaperData } from '../types'
import { parseArxivId } from '../lib/arxiv'
import { ownerContext } from '../server/pipeline/client'
import { isOwner, startReanalysis } from '../server/reanalyze'

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
  }
}
