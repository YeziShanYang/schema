/**
 * Server side of the Library save state (src/lib/membership.ts): adding a
 * paper to a workspace saves it in the reader's Library unless it is saved
 * already, so leaving its last workspace keeps it there. The reader may have
 * no roadmaps row for the paper yet (it was filed before they opened it), in
 * which case one is created with lastOpenedAt 0, which keeps it out of the
 * reader's history of opened papers.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Envelope, RoadmapData } from '../types'
import { savedAtOnFile } from '../lib/membership'

type Tools = Pick<ActionTools, 'query' | 'create' | 'update'>

async function findRoadmap(tools: Tools, userId: string, paperId: string): Promise<Envelope<RoadmapData> | null> {
  const r = await tools.query('roadmaps', { where: { userId, paperId }, limit: 1 })
  if (!r.success) throw new Error(r.error)
  return ((r.data.records as unknown as Envelope<RoadmapData>[])[0] as Envelope<RoadmapData> | undefined) ?? null
}

export async function saveFiledPaper(
  tools: Tools,
  userId: string,
  paper: { paperId: string; arxivId: string; title: string },
  now = Date.now(),
): Promise<void> {
  const row = await findRoadmap(tools, userId, paper.paperId)
  if (row) {
    const savedAt = savedAtOnFile(row.data.savedAt, now)
    if (savedAt !== null) await tools.update('roadmaps', row.recordId, { savedAt })
    return
  }
  const created = await tools.create('roadmaps', {
    userId,
    paperId: paper.paperId,
    arxivId: paper.arxivId,
    title: paper.title,
    status: 'reading',
    lastOpenedAt: 0,
    finishedAt: 0,
    savedAt: now,
  })
  if (created.success) return
  if (!/duplicate|unique/i.test(created.error)) throw new Error(created.error)
  // The reader's browser created the row a moment ago (opening the paper): save that one.
  const raced = await findRoadmap(tools, userId, paper.paperId)
  const savedAt = raced ? savedAtOnFile(raced.data.savedAt, now) : null
  if (raced && savedAt !== null) await tools.update('roadmaps', raced.recordId, { savedAt })
}
