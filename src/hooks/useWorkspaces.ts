/**
 * The signed-in reader's workspaces (own-only collection).
 */

import { useCallback, useMemo } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { WorkspaceData } from '../types'
import { withFinished } from '../lib/workspace'

export interface WorkspacesApi {
  ready: boolean
  status: 'loading' | 'ready' | 'error'
  /** Most recently opened first. */
  rows: RecordData<WorkspaceData>[]
  byId: Map<string, RecordData<WorkspaceData>>
  create: (name: string, description: string) => Promise<string | null>
  update: (id: string, patch: Partial<Pick<WorkspaceData, 'name' | 'description'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  touch: (id: string) => Promise<void>
  markFinished: (id: string, paperId: string) => Promise<void>
}

export function useWorkspaces(): WorkspacesApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<WorkspaceData>('workspaces', { limit: 500 })
  const m = useMutations<WorkspaceData>('workspaces')

  const rows = useMemo(
    () => (isSignedIn ? [...records].sort((a, b) => (b.data.lastOpenedAt ?? 0) - (a.data.lastOpenedAt ?? 0)) : []),
    [records, isSignedIn],
  )
  const byId = useMemo(() => new Map(rows.map((r) => [r.recordId, r])), [rows])

  const create = useCallback<WorkspacesApi['create']>(
    async (name, description) => {
      if (!userId || !name.trim()) return null
      return m.createConfirmed({
        userId,
        name: name.trim().slice(0, 120),
        description: description.trim().slice(0, 1000),
        currentPaperId: '',
        papers: [],
        suggestions: [],
        suggestionsAt: 0,
        lastOpenedAt: Date.now(),
      })
    },
    [m, userId],
  )

  const update = useCallback<WorkspacesApi['update']>((id, patch) => m.put(id, patch), [m])
  const remove = useCallback((id: string) => m.remove(id), [m])

  const touch = useCallback(
    async (id: string) => {
      const ws = byId.get(id)
      if (!ws || Date.now() - (ws.data.lastOpenedAt ?? 0) < 60_000) return
      await m.put(id, { lastOpenedAt: Date.now() })
    },
    [byId, m],
  )

  const markFinished = useCallback(
    async (id: string, paperId: string) => {
      const ws = byId.get(id)
      if (!ws) return
      await m.put(id, { papers: withFinished(ws.data.papers, paperId) })
    },
    [byId, m],
  )

  return { ready: m.ready && !!userId && status === 'ready', status, rows, byId, create, update, remove, touch, markFinished }
}
