/**
 * Re-analysis: re-runs the analyze job on a paper with the current pipeline.
 * Only the app owner may start it (the `reanalyzePaper` action and the
 * `reanalyze_paper` agent tool both check), and it uses no daily slot. This
 * resets the paper record and enqueues the job; the job clears the old
 * concepts and sections, analyzes the paper again, and moves readers'
 * checkmarks to the new concepts by name (lib/knowledge/knowledge-remap). Topics,
 * profile topics, roadmaps and workspaces are kept.
 */

import { enqueueJob } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, PaperData } from '../types'
import { queuedTimings } from '../lib/analysis/timings'

/** Every continue counts as a JobRoom attempt; this leaves room for all ticks plus crash recovery. */
export const ANALYZE_MAX_ATTEMPTS = 60
/** A paper still "processing" after this long is treated as stuck and can be retried. */
export const STUCK_AFTER_MS = 20 * 60 * 1000

export function toMsTime(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') return Date.parse(v) || 0
  return 0
}

export function enqueueAnalyze(env: Env, paperId: string, arxivId: string, userId: string) {
  return enqueueJob(
    env.JOB_ROOMS,
    `app:${env.DEEPSPACE_APP_ID}`,
    'analyze',
    { paperId, arxivId },
    { maxAttempts: ANALYZE_MAX_ATTEMPTS, enqueuedBy: userId },
  )
}

export function isOwner(env: Pick<Env, 'OWNER_USER_ID'>, userId: string): boolean {
  return !!env.OWNER_USER_ID && userId === env.OWNER_USER_ID
}

/** The fields a re-analysis resets; the job fills them in again. Like a retry, it is a new run: its timings and retry count start over. */
export function reanalysisReset(now: number): Record<string, unknown> {
  return {
    status: 'queued',
    stage: 'queued',
    progress: 0,
    progressMessage: 'Waiting to start',
    error: '',
    mainContribution: '',
    conceptCount: 0,
    conceptsWithoutQuote: 0,
    branches: [],
    topicKeys: [],
    overview: null,
    overviewLoadingAt: 0,
    overviewDropped: null,
    timings: queuedTimings(now),
    retries: 0,
  }
}

export type ReanalyzeResult = { ok: true; paperId: string; arxivId: string } | { ok: false; error: string }

/** Resets the paper and enqueues the job. The caller has already checked that the user is the owner. */
export async function startReanalysis(
  env: Env,
  userId: string,
  paper: Envelope<PaperData>,
  update: (recordId: string, data: Record<string, unknown>) => Promise<unknown>,
): Promise<ReanalyzeResult> {
  const running =
    (paper.data.status === 'processing' || paper.data.status === 'queued') && Date.now() - toMsTime(paper.updatedAt) <= STUCK_AFTER_MS
  if (running) return { ok: false, error: 'This paper is being analyzed right now.' }
  await update(paper.recordId, reanalysisReset(Date.now()))
  try {
    await enqueueAnalyze(env, paper.recordId, paper.data.arxivId, userId)
  } catch (e) {
    await update(paper.recordId, {
      status: 'failed',
      stage: 'failed',
      error: `Could not restart the analysis: ${e instanceof Error ? e.message : String(e)}`,
    })
    return { ok: false, error: 'Could not start the re-analysis. Try again.' }
  }
  console.info(`[reanalyze] queued ${paper.data.arxivId}`)
  return { ok: true, paperId: paper.recordId, arxivId: paper.data.arxivId }
}
