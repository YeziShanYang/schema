/**
 * One paper's shared analysis (paper, concepts, sections) joined with the
 * reader's knowledge: branch progress and per-concept status. Readable signed
 * out; the knowledge parts are empty until the reader signs in.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { ConceptData, PaperData, SectionData } from '../types'
import { branchProgress, paperProgress } from '../lib/branches'
import { useKnowledge, useRoadmaps, useTopics } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export function usePaper(arxivId: string) {
  const papersQ = useQuery<PaperData>('papers', { where: { arxivId }, limit: 1 })
  const paper = papersQ.records[0] ?? null
  const paperId = paper?.recordId ?? '__none__'
  const conceptsQ = useQuery<ConceptData>('concepts', { where: { paperId }, limit: 200 })
  const sectionsQ = useQuery<SectionData>('sections', { where: { paperId }, limit: 100 })
  const knowledge = useKnowledge()
  const { byKey: topicsByKey } = useTopics()

  const concepts = useMemo(
    () => [...conceptsQ.records].sort((a, b) => a.data.tier - b.data.tier || a.data.order - b.data.order),
    [conceptsQ.records],
  )
  const sections = useMemo(() => [...sectionsQ.records].sort((a, b) => a.data.order - b.data.order), [sectionsQ.records])
  const conceptByKey = useMemo(() => new Map(concepts.map((c) => [c.data.key, c])), [concepts])

  const branches = useMemo(
    () => branchProgress(paper?.data.branches ?? [], concepts.map((c) => c.data), knowledge.statusOf),
    [paper, concepts, knowledge.statusOf],
  )
  const progress = useMemo(() => paperProgress(concepts.map((c) => c.data), knowledge.statusOf), [concepts, knowledge.statusOf])

  const conceptsInBranch = useCallback(
    (branchKey: string) => concepts.filter((c) => c.data.branchKey === branchKey),
    [concepts],
  )

  return {
    loading: papersQ.status === 'loading',
    paper,
    concepts,
    sections,
    conceptByKey,
    branches,
    progress,
    conceptsInBranch,
    topicsByKey,
    knowledge,
  }
}

/**
 * Marks a paper finished for this reader: roadmap status, the workspace
 * history entry (if it belongs to one), and optionally every remaining topic
 * as known in the knowledge profile.
 */
export function useFinishPaper() {
  const roadmaps = useRoadmaps()
  const knowledge = useKnowledge()
  const workspaces = useWorkspaces()

  return useCallback(
    async (args: {
      paper: RecordData<PaperData>
      concepts: RecordData<ConceptData>[]
      markRemainingKnown: boolean
    }) => {
      const { paper, concepts, markRemainingKnown } = args
      await roadmaps.touch({ paperId: paper.recordId, arxivId: paper.data.arxivId, title: paper.data.title })
      await roadmaps.setStatus(paper.recordId, 'finished')
      for (const ws of workspaces.rows) {
        if (ws.data.papers?.some((p) => p.paperId === paper.recordId)) await workspaces.markFinished(ws.recordId, paper.recordId)
      }
      if (markRemainingKnown) {
        const seen = new Set<string>()
        for (const c of concepts) {
          if (seen.has(c.data.topicKey) || knowledge.statusOf(c.data.topicKey) === 'known') continue
          seen.add(c.data.topicKey)
          await knowledge.set(c.data.topicKey, 'known', 'finished', { paperId: paper.recordId, arxivId: paper.data.arxivId })
        }
      }
    },
    [knowledge, roadmaps, workspaces],
  )
}
