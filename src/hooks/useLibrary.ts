/**
 * The reader's Library: the papers in their workspaces, the papers they
 * saved, and the papers they started on and never removed (the rule is in
 * src/lib/membership.ts). Opening a paper only adds to its history in
 * `roadmaps`. This hook joins the roadmaps rows, the workspaces and the
 * checkmarks into entries, and makes the writes that change membership:
 * save, unsave, add to or remove from a workspace, Remove from Library and
 * creating a workspace with papers in it.
 */

import { useCallback, useMemo } from 'react'
import { checkedPerPaperAll, libraryEntries, savedAtOnFile, savedAtOnRemove, savedAtOnSave, type FiledPaper, type LibraryEntry } from '../lib/membership'
import { useConceptKnowledge, useRoadmaps, type PaperRef } from './useReader'
import { useWorkspaces } from './useWorkspaces'

export type { LibraryEntry } from '../lib/membership'

export interface LibraryApi {
  /** Writes can go out: everything below has loaded and the connection is up. */
  ready: boolean
  /** 'ready' once the roadmaps, the workspaces and their papers, and the checkmarks have loaded; until then membership can't be trusted. */
  status: 'loading' | 'ready' | 'error'
  /** Most recently opened first (lib/membership libraryEntries). */
  entries: LibraryEntry[]
  byPaper: Map<string, LibraryEntry>
  save: (paper: PaperRef) => Promise<void>
  /** Takes the paper out of the Library when it is in no workspace (savedAt 0). */
  unsave: (paper: PaperRef) => Promise<void>
  /** Adds the paper to a workspace and saves it unless it is saved already. */
  addToWorkspace: (workspaceId: string, paper: PaperRef) => Promise<void>
  /** Takes the paper out of one workspace; it stays in the Library. */
  removeFromWorkspace: (workspaceId: string, paperId: string) => Promise<void>
  /** savedAt 0 and out of every workspace. Checkmarks are kept. */
  removeFromLibrary: (paper: PaperRef) => Promise<void>
  /** Creates a workspace holding `papers`, and returns its id. */
  createWorkspace: (name: string, description: string, papers: readonly PaperRef[]) => Promise<string | null>
  /** Removes a workspace. Its papers stay in the Library. */
  removeWorkspace: (workspaceId: string) => Promise<void>
}

export function useLibrary(): LibraryApi {
  const roadmaps = useRoadmaps()
  const workspaces = useWorkspaces()
  const knowledge = useConceptKnowledge()

  const checked = useMemo(() => checkedPerPaperAll(knowledge.rows), [knowledge.rows])
  // Keyed on the rows and papersOf, not the hook's result object, which is new on every render:
  // the entries (and the constellation drawn from them) only change when the data does.
  const { rows: workspaceRows, papersOf: papersIn } = workspaces
  const filed = useMemo<FiledPaper[]>(
    () => workspaceRows.flatMap((w) => papersIn(w.recordId).map((p) => ({ workspaceId: w.recordId, paperId: p.paperId, arxivId: p.arxivId, title: p.title, addedAt: p.addedAt }))),
    [workspaceRows, papersIn],
  )
  const entries = useMemo(() => libraryEntries(roadmaps.rows, filed, checked), [roadmaps.rows, filed, checked])
  const byPaper = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  const statuses = [roadmaps.status, workspaces.status, workspaces.papersStatus, knowledge.status]
  const status = statuses.includes('error') ? 'error' : statuses.every((s) => s === 'ready') ? 'ready' : 'loading'
  const ready = roadmaps.ready && workspaces.ready && knowledge.status === 'ready'

  const { byPaper: roadmapOf, setSavedAt } = roadmaps
  const { addPaper, removePaper, papersOf, create, remove } = workspaces

  // Filing (in either direction) saves the paper first, so it never drops out of the Library in between.
  const saveFiled = useCallback(
    async (paper: PaperRef) => {
      const savedAt = savedAtOnFile(roadmapOf.get(paper.paperId)?.data.savedAt, Date.now())
      if (savedAt !== null) await setSavedAt(paper, savedAt)
    },
    [roadmapOf, setSavedAt],
  )

  const save = useCallback<LibraryApi['save']>((paper) => setSavedAt(paper, savedAtOnSave(Date.now())), [setSavedAt])
  const unsave = useCallback<LibraryApi['unsave']>((paper) => setSavedAt(paper, savedAtOnRemove()), [setSavedAt])

  const addToWorkspace = useCallback<LibraryApi['addToWorkspace']>(
    async (workspaceId, paper) => {
      await saveFiled(paper)
      // A paper the reader finished goes in as finished, as finishing marks it in every workspace that holds it.
      await addPaper(workspaceId, paper, roadmapOf.get(paper.paperId)?.data.status === 'finished' ? 'finished' : 'active')
    },
    [addPaper, roadmapOf, saveFiled],
  )

  const removeFromWorkspace = useCallback<LibraryApi['removeFromWorkspace']>(
    async (workspaceId, paperId) => {
      const entry = byPaper.get(paperId)
      if (entry) await saveFiled({ paperId, arxivId: entry.data.arxivId, title: entry.data.title })
      await removePaper(workspaceId, paperId)
    },
    [byPaper, removePaper, saveFiled],
  )

  const removeFromLibrary = useCallback<LibraryApi['removeFromLibrary']>(
    async (paper) => {
      await setSavedAt(paper, savedAtOnRemove())
      for (const w of workspaces.rows) {
        if (papersOf(w.recordId).some((p) => p.paperId === paper.paperId)) await removePaper(w.recordId, paper.paperId)
      }
    },
    [papersOf, removePaper, setSavedAt, workspaces.rows],
  )

  const createWorkspace = useCallback<LibraryApi['createWorkspace']>(
    async (name, description, papers) => {
      const id = await create(name, description)
      if (!id) return null
      for (const p of papers) await addToWorkspace(id, p)
      return id
    },
    [addToWorkspace, create],
  )

  const removeWorkspace = useCallback<LibraryApi['removeWorkspace']>(
    async (workspaceId) => {
      for (const p of papersOf(workspaceId)) await saveFiled(p)
      await remove(workspaceId)
    },
    [papersOf, remove, saveFiled],
  )

  return { ready, status, entries, byPaper, save, unsave, addToWorkspace, removeFromWorkspace, removeFromLibrary, createWorkspace, removeWorkspace }
}
