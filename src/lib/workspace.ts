/**
 * Pure helpers for a workspace's paper list and its recommendations. A
 * workspace holds any number of papers, each active or finished. Used by the
 * analyzePaper action (adding a paper) and by the browser (finishing or
 * removing one, dismissing a recommendation, and the workspace page's view
 * query and list order).
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

/** Suggestions that are not already papers in the workspace: the graph's candidate nodes and the list's recommended rows. */
export function candidateSuggestions(suggestions: Suggestion[] | null | undefined, papers: WorkspacePaper[] | null | undefined): Suggestion[] {
  const have = new Set((papers ?? []).map((p) => p.arxivId))
  return (suggestions ?? []).filter((s) => !have.has(s.arxivId))
}

/** The suggestions without `arxivId`: dismissing a recommendation. A later recommendation run may suggest it again. */
export function withoutSuggestion(suggestions: Suggestion[] | null | undefined, arxivId: string): Suggestion[] {
  return (suggestions ?? []).filter((s) => s.arxivId !== arxivId)
}

export type WorkspaceView = 'graph' | 'list'

/** The workspace page's view from its URL query: `?view=list` is the list, anything else the graph. */
export function workspaceView(search: string | URLSearchParams): WorkspaceView {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  return p.get('view') === 'list' ? 'list' : 'graph'
}

/** The query with the view set. The graph is the default, so it leaves `view` out. Other parameters are kept. */
export function workspaceViewQuery(search: string | URLSearchParams, view: WorkspaceView): URLSearchParams {
  const out = new URLSearchParams(search)
  if (view === 'list') out.set('view', 'list')
  else out.delete('view')
  return out
}

/**
 * The list view's order: papers not finished, then finished ones, each most
 * recently opened first. A paper the reader never opened counts from when it
 * was added to the workspace.
 */
export function listOrder<T extends Pick<WorkspacePaper, 'paperId' | 'status' | 'addedAt'>>(
  papers: readonly T[],
  lastOpenedAt: (paperId: string) => number | null | undefined,
): T[] {
  const at = (p: T) => lastOpenedAt(p.paperId) || p.addedAt || 0
  const finished = (p: T) => (paperStatus(p) === 'finished' ? 1 : 0)
  return [...papers].sort((a, b) => finished(a) - finished(b) || at(b) - at(a))
}
