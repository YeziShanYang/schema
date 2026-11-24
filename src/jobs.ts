/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job.
 *
 * `analyze` turns one arXiv paper into a roadmap (see src/server/pipeline/run.ts).
 * It is enqueued only by the `analyzePaper` / `retryPaper` server actions,
 * which enforce sign-in and the daily cap; the job room refuses enqueue over
 * the socket from anyone but the app owner.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { runAnalyzeTick } from './server/pipeline/run'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case 'analyze':
      return runAnalyzeTick(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
