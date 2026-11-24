/**
 * Pure helpers for a workspace's paper list. A workspace holds any number of
 * papers, each active or finished. Used by the analyzePaper action (adding a
 * paper) and by the browser (finishing or removing one).
 */

import type { Suggestion, WorkspacePaper } from '../types'

/** Legacy single-target values read as active. */
export function paperStatus(p: Pick<WorkspacePaper, 'status'>): 'active' | 'finished' {
  return p.status === 'finished' ? 'finished' : 'active'
}

/** Add a paper as active, or refresh its title if it is already in the list (status is kept). */
export function withPaper(
  papers: WorkspacePaper[] | null | undefined,
  paper: { paperId: string; arxivId: string; title: string },
  now: number,
): WorkspacePaper[] {
  const list = (papers ?? []).map((p) => ({ ...p, status: paperStatus(p) }))
  if (list.some((p) => p.paperId === paper.paperId)) {
    return list.map((p) => (p.paperId === paper.paperId ? { ...p, title: paper.title || p.title } : p))
  }
  return [...list, { paperId: paper.paperId, arxivId: paper.arxivId, title: paper.title, status: 'active', addedAt: now }]
}

export function withStatus(papers: WorkspacePaper[] | null | undefined, paperId: string, status: 'active' | 'finished'): WorkspacePaper[] {
  return (papers ?? []).map((p) => (p.paperId === paperId ? { ...p, status } : { ...p, status: paperStatus(p) }))
}

/** Mark a paper finished in the list. */
export function withFinished(papers: WorkspacePaper[] | null | undefined, paperId: string): WorkspacePaper[] {
  return withStatus(papers, paperId, 'finished')
}

export function withoutPaper(papers: WorkspacePaper[] | null | undefined, paperId: string): WorkspacePaper[] {
  return (papers ?? []).filter((p) => p.paperId !== paperId)
}

/** Suggestions that are not already papers in the workspace: the graph's candidate nodes. */
export function candidateSuggestions(suggestions: Suggestion[] | null | undefined, papers: WorkspacePaper[] | null | undefined): Suggestion[] {
  const have = new Set((papers ?? []).map((p) => p.arxivId))
  return (suggestions ?? []).filter((s) => !have.has(s.arxivId))
}
