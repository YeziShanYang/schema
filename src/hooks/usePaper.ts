/**
 * One paper's shared analysis (paper, concepts, sections) joined with the
 * reader's per-concept checkmarks: the real rows, or the signed-out demo
 * adapter (useReaderKnowledge). Also reports, per branch, whether its
 * explainer links still need loading.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { ConceptData, KnowledgeStatus, PaperData, SectionData, TopicData } from '../types'
import { branchProgress, paperProgress } from '../lib/branches'
import { parseArxivId } from '../lib/arxiv'
import { recommendedSequence } from '../lib/sequence'
import { useConceptKnowledge, useRoadmaps, useTopics } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export type BranchLinks = 'ready' | 'needs-load' | 'loading'

/**
 * Link state for a set of topics: any topic loading wins, then any topic with
 * no links yet. `ready`, `failed` and `skipped` (a paper-only topic that gets
 * no web search) are all settled.
 */
export function branchLinkState(topics: (TopicData | undefined)[], now = Date.now()): BranchLinks {
  if (topics.some((t) => t?.resourcesStatus === 'loading' && now - (t.resourcesLoadingAt || 0) < 5 * 60 * 1000)) return 'loading'
  if (topics.some((t) => !t || t.resourcesStatus === 'none' || !t.resourcesStatus || t.resourcesStatus === 'loading')) return 'needs-load'
  return 'ready'
}

export function usePaper(rawId: string, knowledge: { statusOf: (conceptId: string) => KnowledgeStatus | null }) {
  // Papers are stored under the id without a version, so "1706.03762v1" finds "1706.03762".
  const arxivId = parseArxivId(rawId)?.id ?? rawId
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

  const { statusOf } = knowledge
  const branches = useMemo(
    () => branchProgress(paper?.data.branches ?? [], concepts.map((c) => ({ branchKey: c.data.branchKey, id: c.recordId })), (c) => statusOf(c.id)),
    [paper, concepts, statusOf],
  )
  const progress = useMemo(() => paperProgress(concepts, (c) => statusOf(c.recordId)), [concepts, statusOf])

  const conceptsInBranch = useCallback(
    (branchKey: string) => concepts.filter((c) => c.data.branchKey === branchKey),
    [concepts],
  )

  const sequence = useMemo(
    () =>
      recommendedSequence(
        paper?.data.branches ?? [],
        concepts.map((c) => ({ ...c.data, key: c.data.key, dependsOn: c.data.dependsOn ?? [], id: c.recordId })),
        (c) => statusOf(c.id ?? ''),
      ),
    [paper, concepts, statusOf],
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
    sequence,
    topicsByKey,
    knowledge,
  }
}

/**
 * Marks a paper finished for this reader: roadmap status, the workspace
 * history entry (if it belongs to one), and optionally every remaining
 * concept of this paper as checked. Nothing in other papers changes.
 */
export function useFinishPaper() {
  const roadmaps = useRoadmaps()
  const knowledge = useConceptKnowledge()
  const workspaces = useWorkspaces()

  return useCallback(
    async (args: {
      paper: RecordData<PaperData>
      concepts: RecordData<ConceptData>[]
      markRemainingKnown: boolean
    }) => {
      const { paper, concepts, markRemainingKnown } = args
      await roadmaps.touch({ paperId: paper.recordId, arxivId: paper.data.arxivId, title: paper.data.title })
      // The checks go first and the finished status last, so a paper never shows finished with its checks still unwritten.
      if (markRemainingKnown) {
        for (const c of concepts) {
          if (knowledge.statusOf(c.recordId) === 'known') continue
          await knowledge.set(
            { conceptId: c.recordId, paperId: paper.recordId, arxivId: paper.data.arxivId, conceptName: c.data.name, topicKey: c.data.topicKey },
            'finished',
          )
        }
      }
      for (const ws of workspaces.rows) {
        if (workspaces.papersOf(ws.recordId).some((p) => p.paperId === paper.recordId)) await workspaces.markFinished(ws.recordId, paper.recordId)
      }
      await roadmaps.setStatus(paper.recordId, 'finished')
    },
    [knowledge, roadmaps, workspaces],
  )
}

/** Moves a finished paper back to reading: its roadmap and the entry in every workspace that holds it. */
export function useReopenPaper() {
  const roadmaps = useRoadmaps()
  const workspaces = useWorkspaces()

  return useCallback(
    async (paperId: string) => {
      await roadmaps.setStatus(paperId, 'reading')
      for (const ws of workspaces.rows) {
        if (workspaces.papersOf(ws.recordId).some((p) => p.paperId === paperId)) await workspaces.setPaperStatus(ws.recordId, paperId, 'active')
      }
    },
    [roadmaps, workspaces],
  )
}
