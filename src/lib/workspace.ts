/**
 * Pure helpers for a workspace's paper history. Used by the analyzePaper
 * action (setting a target) and by the browser (finishing a target).
 */

import type { WorkspacePaper } from '../types'

/** Make `paper` the workspace's current target. The old current target becomes "previous" unless it was finished. */
export function withTarget(
  papers: WorkspacePaper[] | null | undefined,
  paper: { paperId: string; arxivId: string; title: string },
  now: number,
): WorkspacePaper[] {
  const list = (papers ?? []).map((p) => (p.status === 'current' ? { ...p, status: 'previous' as const } : p))
  const existing = list.find((p) => p.paperId === paper.paperId)
  if (existing) {
    return list.map((p) =>
      p.paperId === paper.paperId ? { ...p, title: paper.title || p.title, status: p.status === 'finished' ? 'finished' : 'current' } : p,
    )
  }
  return [...list, { paperId: paper.paperId, arxivId: paper.arxivId, title: paper.title, status: 'current', addedAt: now }]
}

/** Mark a paper finished in the history (it stays the workspace's last target until a new one is set). */
export function withFinished(papers: WorkspacePaper[] | null | undefined, paperId: string): WorkspacePaper[] {
  return (papers ?? []).map((p) => (p.paperId === paperId ? { ...p, status: 'finished' } : p))
}
