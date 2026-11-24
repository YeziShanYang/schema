/**
 * The pipeline's only door to paid services. Real mode goes through the
 * DeepSpace integration proxy, billed to the app owner (developer billing);
 * fixture mode answers from canned data for local tests.
 */

import { buildCronContext } from 'deepspace/worker'
import type { CronContext } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { isFixtureId } from '../../lib/arxiv'
import { fixtureDelayMs, fixtureIntegration, fixtureText } from './fixtures'

export interface PipelineClient {
  readonly fixtures: boolean
  /** Returns the integration's `data`; throws on any failure. */
  call(endpoint: string, body: Record<string, unknown>, hint?: string): Promise<unknown>
  /** Download a text file (e.g. CloudConvert's export URL). */
  fetchText(url: string, signal?: AbortSignal): Promise<string>
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

/** `arxivId` only selects a slow fixture (see fixtureDelayMs); real calls ignore it. */
export function createPipelineClient(env: Env, useFixtures: boolean, ctx: CronContext = ownerContext(env), arxivId = ''): PipelineClient {
  if (useFixtures && env.ALLOW_DEBUG_ROUTES === 'true') {
    const delay = fixtureDelayMs(arxivId)
    return {
      fixtures: true,
      call: async (endpoint, body, hint) => {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        return fixtureIntegration(endpoint, body, hint)
      },
      fetchText: async (url) => fixtureText(url),
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
  }
}
