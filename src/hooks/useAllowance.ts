/**
 * The signed-in reader's remaining daily allowances, from the `myAllowance`
 * action (usage events are server-only). Refreshes after any metered action,
 * when the window regains focus, and when one of the reader's papers
 * finishes its analysis (useRefreshAllowanceOnSettle).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { actions, USAGE_EVENT, type Allowances } from '../lib/actions-client'
import type { PaperData, PaperStatus } from '../types'
import { useRoadmaps } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export function useAllowance() {
  const { isSignedIn } = useAuth()
  const [data, setData] = useState<Allowances | null>(null)

  const refresh = useCallback(async () => {
    if (!isSignedIn) return setData(null)
    const r = await actions.myAllowance()
    if (r.success) setData(r.data)
  }, [isSignedIn])

  useEffect(() => {
    void refresh()
    const onUsage = () => void refresh()
    window.addEventListener(USAGE_EVENT, onUsage)
    window.addEventListener('focus', onUsage)
    return () => {
      window.removeEventListener(USAGE_EVENT, onUsage)
      window.removeEventListener('focus', onUsage)
    }
  }, [refresh])

  return { allowance: data, refresh }
}

/**
 * Refreshes every allowance display when one of the reader's papers (one
 * they opened, or one in their workspaces) turns failed or ready. A failed
 * analysis gives its daily slot back in the background job, long after the
 * action that started it returned, so nothing else would refresh the count.
 * Mount it once, in the app shell.
 */
export function useRefreshAllowanceOnSettle() {
  const roadmaps = useRoadmaps()
  const workspaces = useWorkspaces()
  // The same subscription the workspace and library pages use; papers are public and few.
  const { records } = useQuery<PaperData>('papers', { limit: 2000 })
  const mine = useMemo(() => {
    const ids = new Set(roadmaps.rows.map((r) => r.data.paperId))
    for (const w of workspaces.rows) for (const p of workspaces.papersOf(w.recordId)) ids.add(p.paperId)
    return ids
  }, [roadmaps.rows, workspaces])

  const seen = useRef(new Map<string, PaperStatus>())
  useEffect(() => {
    let settled = false
    for (const p of records) {
      if (!mine.has(p.recordId)) continue
      const before = seen.current.get(p.recordId)
      if (before && before !== p.data.status && (p.data.status === 'failed' || p.data.status === 'ready')) settled = true
      seen.current.set(p.recordId, p.data.status)
    }
    if (settled) window.dispatchEvent(new Event(USAGE_EVENT))
  }, [records, mine])
}
