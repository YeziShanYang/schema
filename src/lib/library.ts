/**
 * The Library page's sorting and filtering, with no React in it: the sort and
 * topic kept in the URL query, the topics of the reader's papers with their
 * counts, the status and topic filters, the grouping by workspace, and the
 * empty-state text.
 */

import type { RoadmapStatus } from '../types'

export type LibrarySort = 'opened' | 'workspace'
export type StatusFilter = 'all' | RoadmapStatus

export interface LibraryQuery {
  sort: LibrarySort
  /** A topic key, or null for every topic. */
  topic: string | null
}

/** Reads the sort and topic from a URL query. Anything other than `sort=workspace` is the default sort. */
export function parseLibraryQuery(search: string | URLSearchParams): LibraryQuery {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  const topic = p.get('topic')?.trim() ?? ''
  return { sort: p.get('sort') === 'workspace' ? 'workspace' : 'opened', topic: topic || null }
}

/**
 * The query with `patch` applied: sort first, then topic, then any other
 * parameters as they were. The default sort and an empty topic are left out.
 */
export function libraryQuery(search: string | URLSearchParams, patch: Partial<LibraryQuery>): URLSearchParams {
  const current = typeof search === 'string' ? new URLSearchParams(search) : search
  const next = { ...parseLibraryQuery(current), ...patch }
  const out = new URLSearchParams()
  if (next.sort === 'workspace') out.set('sort', 'workspace')
  if (next.topic) out.set('topic', next.topic)
  for (const [k, v] of current) if (k !== 'sort' && k !== 'topic') out.append(k, v)
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

/** Topics whose name contains every word of `query`, ignoring case; all of them for an empty query. */
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
 * The rows that pass the status filter and, when a topic is set, use that
 * topic. Order is kept.
 */
export function filterRows<R extends Row>(
  rows: readonly R[],
  { status, topic }: { status: StatusFilter; topic: string | null },
  topicKeysOf: (paperId: string) => readonly string[] | undefined,
): R[] {
  return rows.filter((r) => (status === 'all' || r.data.status === status) && (!topic || (topicKeysOf(r.data.paperId) ?? []).includes(topic)))
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
  all: 'No papers here yet. Papers you open are saved here automatically.',
  reading: 'No papers in progress. A paper you open is listed here until you mark it finished.',
  finished: 'No finished papers yet. Papers you mark finished are listed here.',
}

const WHICH: Record<StatusFilter, string> = {
  all: 'No papers',
  reading: 'No papers in progress',
  finished: 'No finished papers',
}

/** What the Library says when no row passes the filters; with a topic it names the status filter and the topic. */
export function emptyText(status: StatusFilter, topicName: string | null): string {
  return topicName ? `${WHICH[status]} use the topic ${topicName}.` : EMPTY[status]
}
