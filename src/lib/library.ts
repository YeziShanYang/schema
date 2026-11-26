/**
 * The Library page's sorting and filtering, with no React in it: the sort,
 * topic, workspace and view kept in the URL query, the topics and workspaces
 * of the reader's papers with their counts, the status, topic and workspace
 * filters, the grouping by workspace, and the empty-state text. Which papers
 * are in the Library at all is src/lib/membership.ts.
 */

import type { RoadmapStatus } from '../types'

export type LibrarySort = 'opened' | 'workspace'
export type LibraryView = 'list' | 'constellation'
export type StatusFilter = 'all' | RoadmapStatus

/** The workspace filter's value for papers in no workspace (`?ws=none`). */
export const UNFILED = 'none'

export interface LibraryQuery {
  sort: LibrarySort
  /** A topic key, or null for every topic. */
  topic: string | null
  /** A workspace id, UNFILED for papers in no workspace, or null for every paper. */
  ws: string | null
  view: LibraryView
}

const OWN_PARAMS = new Set(['sort', 'topic', 'ws', 'view'])

/**
 * Reads the sort, topic, workspace and view from a URL query. Anything other
 * than `sort=workspace` is the default sort, and anything other than
 * `view=constellation` is the list.
 */
export function parseLibraryQuery(search: string | URLSearchParams): LibraryQuery {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  const topic = p.get('topic')?.trim() ?? ''
  const ws = p.get('ws')?.trim() ?? ''
  return {
    sort: p.get('sort') === 'workspace' ? 'workspace' : 'opened',
    topic: topic || null,
    ws: ws || null,
    view: p.get('view') === 'constellation' ? 'constellation' : 'list',
  }
}

/**
 * The query with `patch` applied: sort first, then topic, workspace and view,
 * then any other parameters as they were. The default sort, an empty topic or
 * workspace and the list view are left out.
 */
export function libraryQuery(search: string | URLSearchParams, patch: Partial<LibraryQuery>): URLSearchParams {
  const current = typeof search === 'string' ? new URLSearchParams(search) : search
  const next = { ...parseLibraryQuery(current), ...patch }
  const out = new URLSearchParams()
  if (next.sort === 'workspace') out.set('sort', 'workspace')
  if (next.topic) out.set('topic', next.topic)
  if (next.ws) out.set('ws', next.ws)
  if (next.view === 'constellation') out.set('view', 'constellation')
  for (const [k, v] of current) if (!OWN_PARAMS.has(k)) out.append(k, v)
  return out
}

export interface TopicCount {
  key: string
  name: string
  /** How many of the reader's papers use the topic. */
  count: number
}

/**
 * The topics used by the given papers, each with how many of them use it,
 * most used first, then by name. A topic missing from `names` is listed under
 * its key.
 */
export function topicCounts(papers: Iterable<{ topicKeys?: readonly string[] | null }>, names: ReadonlyMap<string, string>): TopicCount[] {
  const counts = new Map<string, number>()
  for (const p of papers) for (const key of new Set(p.topicKeys ?? [])) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts]
    .map(([key, count]) => ({ key, name: names.get(key) || key, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

/**
 * The workspace filter's options: every workspace in the order given, each
 * with how many papers it holds, then the papers in no workspace (key
 * UNFILED).
 */
export function workspaceCounts(
  papers: Iterable<{ workspaceIds: readonly string[] }>,
  workspaces: readonly { id: string; name: string }[],
): TopicCount[] {
  const counts = new Map<string, number>()
  let unfiled = 0
  for (const p of papers) {
    if (!p.workspaceIds.length) unfiled++
    for (const id of new Set(p.workspaceIds)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...workspaces.map((w) => ({ key: w.id, name: w.name, count: counts.get(w.id) ?? 0 })), { key: UNFILED, name: NO_WORKSPACE, count: unfiled }]
}

/** Options whose name contains every word of `query`, ignoring case; all of them for an empty query. */
export function matchTopics(topics: TopicCount[], query: string): TopicCount[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return topics
  return topics.filter((t) => {
    const name = t.name.toLowerCase()
    return words.every((w) => name.includes(w))
  })
}

type Row = { data: { paperId: string; status: RoadmapStatus } }

/**
 * The rows that pass the status filter and, when a topic or a workspace is
 * set, use that topic and sit in that workspace (or, for UNFILED, in none).
 * Order is kept.
 */
export function filterRows<R extends Row>(
  rows: readonly R[],
  { status, topic, workspace = null }: { status: StatusFilter; topic: string | null; workspace?: string | null },
  topicKeysOf: (paperId: string) => readonly string[] | undefined,
  workspaceIdsOf: (paperId: string) => readonly string[] = () => [],
): R[] {
  const inWorkspace = (paperId: string) => {
    if (!workspace) return true
    const ids = workspaceIdsOf(paperId)
    return workspace === UNFILED ? ids.length === 0 : ids.includes(workspace)
  }
  return rows.filter(
    (r) => (status === 'all' || r.data.status === status) && (!topic || (topicKeysOf(r.data.paperId) ?? []).includes(topic)) && inWorkspace(r.data.paperId),
  )
}

export interface WorkspaceGroup<R> {
  /** The workspace id, or null for the papers in no workspace. */
  workspaceId: string | null
  name: string
  rows: R[]
}

export const NO_WORKSPACE = 'Not in a workspace'

/**
 * The rows under each workspace, in the order `workspaces` comes in, and the
 * rows in no workspace last. A paper in two workspaces is listed under both.
 * Each group keeps the rows' order, and a group with no rows is left out.
 */
export function groupByWorkspace<R extends { data: { paperId: string } }>(
  rows: readonly R[],
  workspaces: readonly { id: string; name: string; paperIds: Iterable<string> }[],
): WorkspaceGroup<R>[] {
  const groups: WorkspaceGroup<R>[] = []
  const filed = new Set<string>()
  for (const ws of workspaces) {
    const ids = new Set(ws.paperIds)
    for (const id of ids) filed.add(id)
    const inWs = rows.filter((r) => ids.has(r.data.paperId))
    if (inWs.length) groups.push({ workspaceId: ws.id, name: ws.name, rows: inWs })
  }
  const loose = rows.filter((r) => !filed.has(r.data.paperId))
  if (loose.length) groups.push({ workspaceId: null, name: NO_WORKSPACE, rows: loose })
  return groups
}

const EMPTY: Record<StatusFilter, string> = {
  all: 'No papers here yet. A paper is listed here once you save it, add it to a workspace or check one of its concepts.',
  reading: 'No papers in progress. A paper in your Library is listed here until you mark it finished.',
  finished: 'No finished papers yet. Papers you mark finished are listed here.',
}

const WHICH: Record<StatusFilter, string> = {
  all: 'No papers',
  reading: 'No papers in progress',
  finished: 'No finished papers',
}

/** The workspace filter as the empty state names it: a workspace by name, or the papers in none. */
export type WorkspaceWhere = { name: string } | 'unfiled' | null

/**
 * What the Library says when no row passes the filters. With a topic or a
 * workspace it names the status filter and each of them.
 */
export function emptyText(status: StatusFilter, topicName: string | null, workspace: WorkspaceWhere = null): string {
  if (!topicName && !workspace) return EMPTY[status]
  const where = workspace === 'unfiled' ? ' outside a workspace' : workspace ? ` in ${workspace.name}` : ''
  return `${WHICH[status]}${where}${topicName ? ` use the topic ${topicName}` : ''}.`
}
