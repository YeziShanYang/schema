/**
 * The signed-in reader's workspaces (own-only collection) and the papers in
 * each, one `workspace_papers` row per paper. Workspaces from before the rows
 * existed keep a `papers` list; on first load it is copied into rows and
 * emptied, and until then both are read.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { WorkspaceData, WorkspacePaper, WorkspacePaperData } from '../types'
import { paperStatus } from '../lib/workspace'

export interface WorkspacesApi {
  ready: boolean
  status: 'loading' | 'ready' | 'error'
  /** Most recently opened first. */
  rows: RecordData<WorkspaceData>[]
  byId: Map<string, RecordData<WorkspaceData>>
  /** The papers in one workspace, oldest first. */
  papersOf: (id: string) => WorkspacePaper[]
  create: (name: string, description: string) => Promise<string | null>
  update: (id: string, patch: Partial<Pick<WorkspaceData, 'name' | 'description'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  touch: (id: string) => Promise<void>
  markFinished: (id: string, paperId: string) => Promise<void>
  setPaperStatus: (id: string, paperId: string, status: 'active' | 'finished') => Promise<void>
  removePaper: (id: string, paperId: string) => Promise<void>
  markOpened: (id: string, paperId: string) => Promise<void>
}

export function useWorkspaces(): WorkspacesApi {
  const { userId, isSignedIn } = useAuth()
  const { records, status } = useQuery<WorkspaceData>('workspaces', { limit: 500 })
  const m = useMutations<WorkspaceData>('workspaces')
  const papersQ = useQuery<WorkspacePaperData>('workspace_papers', { limit: 5000 })
  const pm = useMutations<WorkspacePaperData>('workspace_papers')

  const rows = useMemo(
    () => (isSignedIn ? [...records].sort((a, b) => (b.data.lastOpenedAt ?? 0) - (a.data.lastOpenedAt ?? 0)) : []),
    [records, isSignedIn],
  )
  const byId = useMemo(() => new Map(rows.map((r) => [r.recordId, r])), [rows])

  // workspaceId -> paperId -> row
  const paperRows = useMemo(() => {
    const map = new Map<string, Map<string, RecordData<WorkspacePaperData>>>()
    if (!isSignedIn) return map
    for (const r of papersQ.records) {
      let inner = map.get(r.data.workspaceId)
      if (!inner) map.set(r.data.workspaceId, (inner = new Map()))
      inner.set(r.data.paperId, r)
    }
    return map
  }, [papersQ.records, isSignedIn])

  const papersOf = useCallback(
    (id: string): WorkspacePaper[] => {
      const out = new Map<string, WorkspacePaper>()
      for (const p of byId.get(id)?.data.papers ?? []) out.set(p.paperId, { ...p, status: paperStatus(p) })
      for (const r of paperRows.get(id)?.values() ?? []) {
        const d = r.data
        out.set(d.paperId, { paperId: d.paperId, arxivId: d.arxivId, title: d.title, status: d.status === 'finished' ? 'finished' : 'active', addedAt: d.addedAt })
      }
      return [...out.values()].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
    },
    [byId, paperRows],
  )

  const allReady = m.ready && pm.ready && !!userId && status === 'ready' && papersQ.status === 'ready'

  // Move legacy lists into rows once per workspace; uniqueOn makes a repeat harmless.
  const migrated = useRef(new Set<string>())
  useEffect(() => {
    if (!allReady || !userId) return
    for (const ws of rows) {
      const legacy = ws.data.papers ?? []
      if (!legacy.length || migrated.current.has(ws.recordId)) continue
      migrated.current.add(ws.recordId)
      void (async () => {
        for (const p of legacy) {
          if (paperRows.get(ws.recordId)?.has(p.paperId)) continue
          try {
            await pm.createConfirmed({ userId, workspaceId: ws.recordId, paperId: p.paperId, arxivId: p.arxivId, title: p.title, status: paperStatus(p), addedAt: p.addedAt || Date.now() })
          } catch {
            // already moved by another tab
          }
        }
        await m.putConfirmed(ws.recordId, { papers: [] })
      })()
    }
  }, [allReady, rows, paperRows, pm, m, userId])

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
  const remove = useCallback(
    async (id: string) => {
      for (const r of paperRows.get(id)?.values() ?? []) await pm.remove(r.recordId)
      await m.remove(id)
    },
    [m, pm, paperRows],
  )

  const touch = useCallback(
    async (id: string) => {
      const ws = byId.get(id)
      if (!ws || Date.now() - (ws.data.lastOpenedAt ?? 0) < 60_000) return
      await m.put(id, { lastOpenedAt: Date.now() })
    },
    [byId, m],
  )

  const setPaperStatus = useCallback(
    async (id: string, paperId: string, next: 'active' | 'finished') => {
      const row = paperRows.get(id)?.get(paperId)
      if (row) return pm.put(row.recordId, { status: next })
      const legacy = byId.get(id)?.data.papers?.find((p) => p.paperId === paperId)
      if (legacy && userId) {
        await pm.createConfirmed({ userId, workspaceId: id, paperId, arxivId: legacy.arxivId, title: legacy.title, status: next, addedAt: legacy.addedAt || Date.now() })
      }
    },
    [byId, paperRows, pm, userId],
  )
  const markFinished = useCallback((id: string, paperId: string) => setPaperStatus(id, paperId, 'finished'), [setPaperStatus])

  const removePaper = useCallback(
    async (id: string, paperId: string) => {
      const ws = byId.get(id)
      if (!ws) return
      const row = paperRows.get(id)?.get(paperId)
      if (row) await pm.remove(row.recordId)
      const legacy = ws.data.papers ?? []
      await m.put(id, {
        ...(legacy.some((p) => p.paperId === paperId) ? { papers: legacy.filter((p) => p.paperId !== paperId) } : {}),
        currentPaperId: ws.data.currentPaperId === paperId ? '' : ws.data.currentPaperId,
      })
    },
    [byId, m, pm, paperRows],
  )

  const markOpened = useCallback(
    async (id: string, paperId: string) => {
      const ws = byId.get(id)
      if (!ws || ws.data.currentPaperId === paperId) return
      await m.put(id, { currentPaperId: paperId, lastOpenedAt: Date.now() })
    },
    [byId, m],
  )

  return {
    ready: allReady,
    status,
    rows,
    byId,
    papersOf,
    create,
    update,
    remove,
    touch,
    markFinished,
    setPaperStatus,
    removePaper,
    markOpened,
  }
}
