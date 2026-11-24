/**
 * Browser-side caller for server actions (POST /api/actions/:name).
 */

import { getAuthToken } from 'deepspace'
import type { PaperOverview, Suggestion } from '../types'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function callAction<T>(name: string, params: Record<string, unknown> = {}): Promise<ActionResponse<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Sign in first.' }
  let res: Response
  try {
    res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // fall through
  }
  if (body && typeof body === 'object' && 'success' in body) return body as ActionResponse<T>
  return { success: false, error: res.status === 401 ? 'Sign in first.' : `Request failed (${res.status}).` }
}

// Typed wrappers for each server action.


export interface AnalyzeResult {
  paperId: string
  arxivId: string
  existing: boolean
  status: string
  workspaceId?: string
}

export interface PaperPeek {
  arxivId: string
  /** The paper's record id once anyone has started it, else ''. */
  paperId: string
  title: string
  authors: string[]
  year: string
  primaryCategory: string
  categoryName: string
  suggestedWorkspaceName: string
  analyzed: boolean
  status: string
}

export interface Allowance {
  used: number
  remaining: number
  allowed: boolean
  nextSlotAt: number
}

export interface Allowances {
  analyze: Allowance
  recommend: Allowance
  explain: Allowance
  branch: Allowance
  overview: Allowance
}

/** Fired after a metered action so allowance displays refresh. */
export const USAGE_EVENT = 'schema:usage'

async function metered<T>(p: Promise<ActionResponse<T>>): Promise<ActionResponse<T>> {
  const r = await p
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_EVENT))
  return r
}

export const actions = {
  myAllowance: () => callAction<Allowances>('myAllowance'),
  analyzePaper: (input: string, workspaceId?: string) =>
    metered(callAction<AnalyzeResult>('analyzePaper', workspaceId ? { input, workspaceId } : { input })),
  retryPaper: (paperId: string) => metered(callAction<{ paperId: string }>('retryPaper', { paperId })),
  seedTopics: () => callAction<{ remaining: number }>('seedTopics'),
  recommendPapers: (workspaceId: string, mode: 'starter' | 'next' = 'next') =>
    metered(callAction<{ suggestions: Suggestion[]; remaining: number }>('recommendPapers', { workspaceId, mode })),
  peekPaper: (input: string) => callAction<PaperPeek>('peekPaper', { input }),
  addPaperToNewWorkspace: (input: string, name: string) =>
    metered(callAction<AnalyzeResult>('analyzePaper', { input, newWorkspace: { name } })),
  explainConcept: (conceptId: string) =>
    metered(callAction<{ explanation: string; cached: boolean }>('explainConcept', { conceptId })),
  loadBranchResources: (paperId: string, branchKey: string) =>
    metered(
      callAction<{ loaded: number; failed: number; remaining: number; busy: number; allowanceLeft: number }>('loadBranchResources', {
        paperId,
        branchKey,
      }),
    ),
  ensureOverview: (paperId: string) =>
    metered(callAction<{ overview?: PaperOverview; cached?: boolean; pending?: boolean }>('ensureOverview', { paperId })),
}
