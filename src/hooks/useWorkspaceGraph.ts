/**
 * Everything a workspace view needs, joined in one place: the workspace, its
 * papers with each paper's analysis status and the reader's progress on it,
 * and the recommendations that are not yet in the workspace (candidate
 * nodes). Progress is the reader's checked concepts in each paper over its
 * concept count, so no concepts are loaded here.
 */

import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { PaperData, PaperStatus, Suggestion, WorkspaceData } from '../types'
import { candidateSuggestions, paperStatus } from '../lib/workspace'
import { checkedPerPaper, useConceptKnowledge } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export interface WorkspacePaperNode {
  paperId: string
  arxivId: string
  title: string
  status: 'active' | 'finished'
  addedAt: number
  /** Analysis status of the shared paper; null while the record loads. */
  analysis: PaperStatus | null
  progressMessage: string
  analysisProgress: number
  known: number
  total: number
  isLastOpened: boolean
  paper: RecordData<PaperData> | null
}

export function useWorkspaceGraph(workspaceId: string) {
  const workspaces = useWorkspaces()
  const knowledge = useConceptKnowledge()
  const ws: RecordData<WorkspaceData> | undefined = workspaces.byId.get(workspaceId)
  // Papers are public and few; one subscription covers every workspace paper.
  const papersQ = useQuery<PaperData>('papers', { limit: 2000 })

  const byId = useMemo(() => new Map(papersQ.records.map((p) => [p.recordId, p])), [papersQ.records])
  const checked = useMemo(() => checkedPerPaper(knowledge.rows), [knowledge.rows])

  const papers = useMemo<WorkspacePaperNode[]>(() => {
    if (!ws) return []
    return workspaces.papersOf(ws.recordId).map((wp) => {
      const paper = byId.get(wp.paperId) ?? null
      const total = paper?.data.conceptCount ?? 0
      return {
        paperId: wp.paperId,
        arxivId: wp.arxivId,
        title: paper?.data.title || wp.title,
        status: paperStatus(wp),
        addedAt: wp.addedAt,
        analysis: paper?.data.status ?? null,
        progressMessage: paper?.data.progressMessage ?? '',
        analysisProgress: paper?.data.progress ?? 0,
        known: Math.min(checked.get(wp.paperId) ?? 0, total),
        total,
        isLastOpened: ws.data.currentPaperId === wp.paperId,
        paper,
      }
    })
  }, [ws, workspaces, byId, checked])

  const candidates: Suggestion[] = useMemo(
    () => (ws ? candidateSuggestions(ws.data.suggestions, workspaces.papersOf(ws.recordId)) : []),
    [ws, workspaces],
  )

  return {
    loading: workspaces.status === 'loading',
    workspace: ws ?? null,
    papers,
    active: papers.filter((p) => p.status === 'active'),
    finished: papers.filter((p) => p.status === 'finished'),
    candidates,
    workspaces,
  }
}
