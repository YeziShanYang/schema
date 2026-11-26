/**
 * Library membership and the save transitions, with no React in it.
 *
 * A paper is in the reader's Library when it is in at least one of their
 * workspaces, when they saved it, or when they started on it (checked one of
 * its concepts, read its overview or marked it finished) and never removed
 * it. Opening a paper writes its roadmaps row for history (Recent papers,
 * Continue) but never adds it.
 *
 * `savedAt` on the roadmaps row has three states: missing (the reader never
 * decided, so starting on the paper counts), a time (saved) and 0 (removed
 * by the reader). Rows from before the field existed read as missing, so
 * they need no migration.
 */

import type { RoadmapStatus } from '../types'

export type SaveState = 'undecided' | 'saved' | 'removed'

export function saveState(savedAt: number | null | undefined): SaveState {
  if (savedAt === null || savedAt === undefined || Number.isNaN(savedAt)) return 'undecided'
  return savedAt > 0 ? 'saved' : 'removed'
}

/** Whether the reader started on the paper: a checked concept, the overview read, or the paper finished. */
export function hasStarted(row: { status?: string; overviewReadAt?: number | null } | null | undefined, checkedConcepts: number): boolean {
  return checkedConcepts > 0 || !!row?.overviewReadAt || row?.status === 'finished'
}

/**
 * The reader's checked concepts per paper id, for hasStarted. Stale rows (a
 * re-analysis found no matching concept) count too: the reader still did
 * work on that paper.
 */
export function checkedPerPaperAll(rows: readonly { data: { paperId: string; status?: string } }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) if (r.data.status === 'known') m.set(r.data.paperId, (m.get(r.data.paperId) ?? 0) + 1)
  return m
}

/** In a workspace, or saved, or started and never decided. */
export function inLibrary({ savedAt, workspaceCount, started }: { savedAt: number | null | undefined; workspaceCount: number; started: boolean }): boolean {
  if (workspaceCount > 0) return true
  const s = saveState(savedAt)
  return s === 'saved' || (s === 'undecided' && started)
}

// Transitions. Each returns the new savedAt, or null when the row keeps the value it has.

/** Save: the paper stays in the Library whatever else changes. */
export function savedAtOnSave(now: number): number {
  return now
}

/** Unsave, and Remove from Library (which also takes the paper out of every workspace): removed by the reader. */
export function savedAtOnRemove(): number {
  return 0
}

/**
 * Adding a paper to a workspace, or taking it out of one, saves it unless it
 * is saved already, so leaving its last workspace keeps it in the Library.
 * The removal side covers papers filed before `savedAt` existed.
 */
export function savedAtOnFile(current: number | null | undefined, now: number): number | null {
  return saveState(current) === 'saved' ? null : now
}

/**
 * Reading a finished paper again: an undecided paper is saved, so the row
 * does not leave the Library just because it stopped being finished.
 */
export function savedAtOnReopen(current: number | null | undefined, now: number): number | null {
  return saveState(current) === 'undecided' ? now : null
}

export interface RoadmapRow {
  recordId: string
  data: {
    paperId: string
    arxivId: string
    title: string
    status?: RoadmapStatus | string
    lastOpenedAt?: number | null
    overviewReadAt?: number | null
    savedAt?: number | null
  }
}

/** One paper in one workspace. */
export interface FiledPaper {
  workspaceId: string
  paperId: string
  arxivId: string
  title: string
  addedAt?: number | null
}

export interface LibraryEntryData {
  paperId: string
  arxivId: string
  title: string
  status: RoadmapStatus
  /** 0 when the reader has saved or filed the paper but never opened it. */
  lastOpenedAt: number
  savedAt: number | null
  /** The workspaces holding the paper, in the order they were passed in. */
  workspaceIds: string[]
  /** The roadmaps row, or null for a paper that is only in a workspace. */
  roadmapId: string | null
}

/** Shaped like a record (`data.paperId`, `data.status`) so the Library's filters and grouping take it as they are. */
export interface LibraryEntry {
  id: string
  data: LibraryEntryData
}

/**
 * The papers in the Library, most recently opened first. Papers never
 * opened come after the opened ones, most recently saved or filed first.
 * `checked` counts the reader's checked concepts per paper id.
 */
export function libraryEntries(
  roadmaps: readonly RoadmapRow[],
  filed: readonly FiledPaper[],
  checked: ReadonlyMap<string, number>,
): LibraryEntry[] {
  const byPaper = new Map<string, { workspaceIds: string[]; first: FiledPaper; addedAt: number }>()
  for (const f of filed) {
    const e = byPaper.get(f.paperId)
    if (!e) byPaper.set(f.paperId, { workspaceIds: [f.workspaceId], first: f, addedAt: f.addedAt ?? 0 })
    else {
      if (!e.workspaceIds.includes(f.workspaceId)) e.workspaceIds.push(f.workspaceId)
      e.addedAt = Math.max(e.addedAt, f.addedAt ?? 0)
    }
  }

  const out: { entry: LibraryEntry; since: number }[] = []
  const seen = new Set<string>()
  for (const r of roadmaps) {
    const d = r.data
    if (seen.has(d.paperId)) continue
    seen.add(d.paperId)
    const ws = byPaper.get(d.paperId)
    const savedAt = d.savedAt ?? null
    const member = inLibrary({ savedAt, workspaceCount: ws?.workspaceIds.length ?? 0, started: hasStarted(d, checked.get(d.paperId) ?? 0) })
    if (!member) continue
    out.push({
      entry: {
        id: d.paperId,
        data: {
          paperId: d.paperId,
          arxivId: d.arxivId || ws?.first.arxivId || '',
          title: d.title || ws?.first.title || '',
          status: d.status === 'finished' ? 'finished' : 'reading',
          lastOpenedAt: d.lastOpenedAt ?? 0,
          savedAt,
          workspaceIds: ws?.workspaceIds ?? [],
          roadmapId: r.recordId,
        },
      },
      since: Math.max(saveState(savedAt) === 'saved' ? savedAt! : 0, ws?.addedAt ?? 0),
    })
  }
  for (const [paperId, ws] of byPaper) {
    if (seen.has(paperId)) continue
    out.push({
      entry: {
        id: paperId,
        data: {
          paperId,
          arxivId: ws.first.arxivId,
          title: ws.first.title,
          status: 'reading',
          lastOpenedAt: 0,
          savedAt: null,
          workspaceIds: ws.workspaceIds,
          roadmapId: null,
        },
      },
      since: ws.addedAt,
    })
  }
  return out
    .sort(
      (a, b) =>
        b.entry.data.lastOpenedAt - a.entry.data.lastOpenedAt ||
        b.since - a.since ||
        (a.entry.data.title || a.entry.data.arxivId).localeCompare(b.entry.data.title || b.entry.data.arxivId),
    )
    .map((x) => x.entry)
}

/**
 * The placement button's label: "Save" outside the Library, "In Library"
 * when the paper is in no workspace, else the first workspace and how many
 * more ("In CS 229 +1").
 */
export function placementLabel(member: boolean, workspaceNames: readonly string[]): string {
  if (!member) return 'Save'
  if (!workspaceNames.length) return 'In Library'
  return workspaceNames.length === 1 ? `In ${workspaceNames[0]}` : `In ${workspaceNames[0]} +${workspaceNames.length - 1}`
}

/** How many of `paperIds` a workspace holds already: all, some or none of them. */
export function coverage(inWorkspace: ReadonlySet<string>, paperIds: readonly string[]): 'all' | 'some' | 'none' {
  const n = paperIds.filter((id) => inWorkspace.has(id)).length
  return n === 0 ? 'none' : n === paperIds.length ? 'all' : 'some'
}

/** "A", "A and B", "A, B and C". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What Remove from Library does, for its confirm: the workspaces it leaves, and that the checkmarks stay. */
export function removeText(workspaceNames: readonly string[]): string {
  const n = workspaceNames.length
  const leaves =
    n === 0
      ? 'It leaves your Library.'
      : n === 1
        ? `It leaves your Library and is taken out of ${workspaceNames[0]}.`
        : `It leaves your Library and is taken out of ${n} workspaces: ${nameList(workspaceNames)}.`
  return `${leaves} Your checkmarks stay, so your progress is kept if you add it again.`
}
