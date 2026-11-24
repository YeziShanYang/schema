/**
 * Browser-side caller for server actions (POST /api/actions/:name).
 */

import { getAuthToken } from 'deepspace'
import type { Suggestion } from '../types'

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
}

export const actions = {
  analyzePaper: (input: string, workspaceId?: string) =>
    callAction<AnalyzeResult>('analyzePaper', workspaceId ? { input, workspaceId } : { input }),
  retryPaper: (paperId: string) => callAction<{ paperId: string }>('retryPaper', { paperId }),
  seedTopics: () => callAction<{ remaining: number }>('seedTopics'),
  recommendPapers: (workspaceId: string) =>
    callAction<{ suggestions: Suggestion[]; remaining: number }>('recommendPapers', { workspaceId }),
  explainConcept: (conceptId: string) =>
    callAction<{ explanation: string; cached: boolean }>('explainConcept', { conceptId }),
}
