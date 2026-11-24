/**
 * One paper's shared analysis (paper, concepts, sections) joined with a
 * knowledge API: the reader's real profile, or the signed-out demo adapter
 * (useReaderKnowledge). Also reports, per branch, whether its explainer links
 * still need loading.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { ConceptData, PaperData, SectionData, TopicData } from '../types'
import { branchProgress, paperProgress } from '../lib/branches'
import { useKnowledge, useRoadmaps, useTopics, type KnowledgeApi } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export type BranchLinks = 'ready' | 'needs-load' | 'loading'

/** Link state for a set of topics: any topic loading wins, then any topic with no links yet. */
export function branchLinkState(topics: (TopicData | undefined)[], now = Date.now()): BranchLinks {
  if (topics.some((t) => t?.resourcesStatus === 'loading' && now - (t.resourcesLoadingAt || 0) < 5 * 60 * 1000)) return 'loading'
  if (topics.some((t) => !t || t.resourcesStatus === 'none' || !t.resourcesStatus || t.resourcesStatus === 'loading')) return 'needs-load'
  return 'ready'
}

export function usePaper(arxivId: string, knowledge: KnowledgeApi) {
  const papersQ = useQuery<PaperData>('papers', { where: { arxivId }, limit: 1 })
  const paper = papersQ.records[0] ?? null
  const paperId = paper?.recordId ?? '__none__'
  const conceptsQ = useQuery<ConceptData>('concepts', { where: { paperId }, limit: 200 })
  const sectionsQ = useQuery<SectionData>('sections', { where: { paperId }, limit: 100 })
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

  const linksForBranch = useCallback(
    (branchKey: string): BranchLinks =>
      branchLinkState(concepts.filter((c) => c.data.branchKey === branchKey).map((c) => topicsByKey.get(c.data.topicKey)?.data)),
    [concepts, topicsByKey],
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
    linksForBranch,
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
