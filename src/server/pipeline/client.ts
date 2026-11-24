/**
 * The pipeline's only door to paid services. Real mode goes through the
 * DeepSpace integration proxy, billed to the app owner (developer billing);
 * fixture mode answers from canned data for local tests.
 */

import { buildCronContext } from 'deepspace/worker'
import type { CronContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { isFixtureId } from '../../lib/arxiv'
import { fixtureHtml, fixtureIntegration, fixtureText } from './fixtures'

/** A generic client name for arXiv; no contact details. */
const USER_AGENT = 'Mozilla/5.0 (compatible; SchemaReader/1.0)'
/** One retry after a 429, waiting what Retry-After asks for, within these bounds. */
const RATE_LIMIT_WAIT_MS = { min: 2000, default: 5000, max: 15000 }

export interface PipelineClient {
  readonly fixtures: boolean
  /** Returns the integration's `data`; throws on any failure. */
  call(endpoint: string, body: Record<string, unknown>, hint?: string): Promise<unknown>
  /** Download a text file (e.g. CloudConvert's export URL). */
  fetchText(url: string, signal?: AbortSignal): Promise<string>
  /** Fetch a public page (the arXiv HTML) without throwing on a 404. */
  fetchPage(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }>
}

/** Milliseconds to wait after a 429, from its Retry-After header (seconds or a date). */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return RATE_LIMIT_WAIT_MS.default
  const secs = Number(header)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now
  if (!Number.isFinite(ms)) return RATE_LIMIT_WAIT_MS.default
  return Math.min(RATE_LIMIT_WAIT_MS.max, Math.max(RATE_LIMIT_WAIT_MS.min, ms))
}

/** One GET with a generic User-Agent; a 429 is retried once after a backoff. */
export async function fetchPublicPage(
  url: string,
  signal?: AbortSignal,
  doFetch: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ status: number; text: string }> {
  const get = () => doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'follow', signal: signal ?? AbortSignal.timeout(30_000) })
  let res = await get()
  if (res.status === 429) {
    await sleep(retryAfterMs(res.headers.get('retry-after')))
    res = await get()
  }
  return { status: res.status, text: res.ok ? await res.text() : '' }
}

/** Fixture mode is possible only in local dev/test runs, and only for fixture ids. */
export function fixturesAllowed(env: Env, arxivId: string): boolean {
  return env.ALLOW_DEBUG_ROUTES === 'true' && isFixtureId(arxivId)
}

/** Workspaces whose name starts with this marker get canned recommendations in local test runs. */
export const FIXTURE_WORKSPACE_PREFIX = '[fixture]'

export function fixtureWorkspace(env: Env, name: string): boolean {
  return env.ALLOW_DEBUG_ROUTES === 'true' && name.startsWith(FIXTURE_WORKSPACE_PREFIX)
}

export function ownerContext(env: Env): CronContext {
  return buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
}

export function createPipelineClient(env: Env, useFixtures: boolean, ctx: CronContext = ownerContext(env)): PipelineClient {
  if (useFixtures && env.ALLOW_DEBUG_ROUTES === 'true') {
    return {
      fixtures: true,
      call: async (endpoint, body, hint) => fixtureIntegration(endpoint, body, hint),
      fetchText: async (url) => fixtureText(url),
      fetchPage: async (url) => fixtureHtml(url),
    }
  }
  return {
    fixtures: false,
    call: (endpoint, body) => ctx.integrations.call(endpoint, body),
    fetchText: async (url, signal) => {
      const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`Download failed with status ${res.status}`)
      return res.text()
    },
    fetchPage: (url, signal) => fetchPublicPage(url, signal),
  }
}
