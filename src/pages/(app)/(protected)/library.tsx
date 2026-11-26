/**
 * Library: every paper the reader has opened, with progress and last opened,
 * filtered by in progress or finished and by a topic from the reader's own
 * papers, and sorted by last opened or grouped by workspace. The sort, the
 * topic and the view are kept in the URL query
 * (?sort=workspace&topic=<key>&view=constellation); the status filter is not.
 * Finished papers can be read again, and a failed analysis can be retried from
 * its row.
 * The list is the default view. The constellation (TopicConstellation, loaded
 * only when it is opened) draws the same filtered papers linked by the topics
 * they share; Sort means nothing there and is hidden. Where the page's column
 * is under 640px wide the toggle is hidden and the list always shows.
 * Finishing and reading again go through the same hooks and dialog as the
 * paper window, so the paper's workspace entries follow, and Read again
 * offers to uncheck what finishing checked.
 */

import { Suspense, lazy, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Button, Popover, PopoverContent, PopoverTrigger, SearchInput } from '@/components/ui'
import { cn, plural } from '@/lib/utils'
import { Chip, Meter, PageHeader } from '../../../components/blueprint'
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../../../components/icons'
import type { ConstellationPaper } from '../../../components/graph/TopicConstellation'
import { FinishDialog, ReadAgainButton } from '../../../components/paper/FinishDialog'
import { checkedPerPaper, useConceptKnowledge, useRoadmaps, useTopics } from '../../../hooks/useReader'
import { useRetryPaper } from '../../../hooks/useRetryPaper'
import { useWorkspaces } from '../../../hooks/useWorkspaces'
import { arxivSlug } from '../../../lib/arxiv'
import { emptyText, filterRows, groupByWorkspace, libraryQuery, matchTopics, parseLibraryQuery, topicCounts } from '../../../lib/library'
import type { LibraryQuery, LibrarySort, LibraryView, StatusFilter, TopicCount } from '../../../lib/library'
import { constellationHeight, libraryNetwork } from '../../../lib/library-network'
import type { PaperData, RoadmapData } from '../../../types'

const STATUS_LABEL: Record<StatusFilter, string> = { all: 'All', reading: 'In progress', finished: 'Finished' }
const SORT_LABEL: Record<LibrarySort, string> = { opened: 'Last opened', workspace: 'Workspace' }
const VIEW_LABEL: Record<LibraryView, string> = { list: 'List', constellation: 'Constellation' }
/** The constellation needs a column at least this wide; below it the list shows, as the floating graphs stack. */
const CONSTELLATION_MIN_WIDTH = 640

const TopicConstellation = lazy(() => import('../../../components/graph/TopicConstellation'))

export default function LibraryPage() {
  const roadmaps = useRoadmaps()
  const workspaces = useWorkspaces()
  const { byKey: topicsByKey } = useTopics()
  const knowledge = useConceptKnowledge()
  const checked = useMemo(() => checkedPerPaper(knowledge.rows), [knowledge.rows])
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const paperById = useMemo(() => new Map(papers.records.map((p) => [p.recordId, p])), [papers.records])
  // Counts show once the papers (their concept counts) and the reader's checkmarks are in; until then "…", not "0 / 0".
  const countsReady = papers.status === 'ready' && knowledge.status === 'ready'
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [finishing, setFinishing] = useState<RecordData<PaperData> | null>(null)

  // Sort, topic and view live in the URL. Changes replace the entry, so Back leaves the Library instead of undoing a filter.
  const [searchParams, setSearchParams] = useSearchParams()
  const { sort, topic, view } = parseLibraryQuery(searchParams)
  const updateQuery = useCallback(
    (patch: Partial<LibraryQuery>) => setSearchParams((prev) => libraryQuery(prev, patch), { replace: true }),
    [setSearchParams],
  )

  const topicKeysOf = useCallback((paperId: string) => paperById.get(paperId)?.data.topicKeys, [paperById])
  const topicNames = useMemo(() => new Map([...topicsByKey].map(([key, r]) => [key, r.data.name])), [topicsByKey])
  const topics = useMemo(
    () => topicCounts(roadmaps.rows.map((r) => ({ topicKeys: topicKeysOf(r.data.paperId) })), topicNames),
    [roadmaps.rows, topicKeysOf, topicNames],
  )
  const topicName = topic ? topicNames.get(topic) || topic : null

  // The column's content width decides whether the constellation can show. Measured before paint, so there is no flash.
  const column = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const next = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) >= CONSTELLATION_MIN_WIDTH
      setWide((w) => (w === next ? w : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const constellation = wide && view === 'constellation'

  const rows = useMemo(() => filterRows(roadmaps.rows, { status: filter, topic }, topicKeysOf), [roadmaps.rows, filter, topic, topicKeysOf])
  const { rows: workspaceRows, papersOf } = workspaces
  const groups = useMemo(
    () =>
      sort === 'workspace' && !constellation
        ? groupByWorkspace(
            rows,
            workspaceRows.map((w) => ({ id: w.recordId, name: w.data.name, paperIds: papersOf(w.recordId).map((p) => p.paperId) })),
          )
        : null,
    [sort, constellation, rows, workspaceRows, papersOf],
  )
  // A topic needs the papers' topic keys, and the grouping needs the workspaces, before the list can be trusted.
  // The constellation draws topics, so it waits for the papers too.
  const loading =
    ((!!topic || constellation) && papers.status === 'loading') ||
    (!constellation && sort === 'workspace' && !workspaces.ready && workspaces.status !== 'error')

  const network = useMemo(() => {
    if (!constellation) return null
    const shown: ConstellationPaper[] = rows.map((r) => {
      const paper = paperById.get(r.data.paperId)
      const total = paper?.data.conceptCount || 0
      const status = paper?.data.status
      return {
        id: r.data.paperId,
        arxivId: r.data.arxivId,
        title: r.data.title || r.data.arxivId,
        topicKeys: paper?.data.topicKeys ?? [],
        known: Math.min(checked.get(r.data.paperId) ?? 0, total),
        total,
        state: status === 'failed' ? 'failed' : status === 'queued' || status === 'processing' ? 'analyzing' : 'ready',
      }
    })
    return libraryNetwork(shown, knowledge.rows.map((k) => k.data), topicNames)
  }, [constellation, rows, paperById, checked, knowledge.rows, topicNames])

  const topicButton = useRef<HTMLButtonElement>(null)
  const clearTopic = () => {
    updateQuery({ topic: null })
    topicButton.current?.focus()
  }
  const clearFilters = () => {
    setFilter('all')
    updateQuery({ topic: null })
    topicButton.current?.focus()
  }

  const groupId = useId()
  const renderRow = (r: RecordData<RoadmapData>, keyPrefix = '') => {
    const paper = paperById.get(r.data.paperId)
    const total = paper?.data.conceptCount || 0
    return (
      <LibraryRow
        key={keyPrefix + r.recordId}
        row={r}
        paper={paper}
        total={total}
        known={Math.min(checked.get(r.data.paperId) ?? 0, total)}
        countsReady={countsReady}
        onFinish={() => setFinishing(paper ?? null)}
      />
    )
  }

  return (
    <div className="min-h-full" data-testid="library-page">
      <PageHeader title="Your papers">
        {wide && (
          <Segmented
            label="Library view"
            options={['list', 'constellation'] as const}
            labels={VIEW_LABEL}
            value={view}
            onChange={(v) => updateQuery({ view: v })}
            testId="library-view"
          />
        )}
      </PageHeader>
      {/* The constellation gets the page's full width (to 1280px); the list keeps its narrower column. */}
      <div ref={column} className={cn('grid gap-4 px-5 py-6 md:px-7', network && rows.length > 0 && !loading ? 'max-w-7xl' : 'max-w-4xl')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="library-controls">
          <Segmented label="Filter papers" options={['all', 'reading', 'finished'] as const} labels={STATUS_LABEL} value={filter} onChange={setFilter} />
          {!constellation && (
            <div className="flex items-center gap-2">
              <span className="label" aria-hidden="true">Sort</span>
              <Segmented label="Sort papers" options={['opened', 'workspace'] as const} labels={SORT_LABEL} value={sort} onChange={(s) => updateQuery({ sort: s })} testId="library-sort" />
            </div>
          )}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <TopicPicker topics={topics} value={topic} loading={papers.status === 'loading'} onChange={(key) => updateQuery({ topic: key })} triggerRef={topicButton} />
            {topic && (
              <span
                className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-0.5 rounded-[3px] border border-transparent bg-accent-soft pl-2.5 pr-0.5 text-[13px] text-primary"
                data-testid="library-topic-chip"
              >
                <span className="min-w-0 truncate">Topic: {topicName}</span>
                <button
                  type="button"
                  onClick={clearTopic}
                  aria-label={`Clear topic ${topicName}`}
                  className="press grid size-[26px] flex-none cursor-pointer place-items-center rounded-[3px] outline-none hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/70"
                  data-testid="library-topic-clear"
                >
                  <CloseIcon size={14} weight={2} />
                </button>
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <p className="surface p-5 text-sm text-muted-foreground" data-testid="library-loading">Loading…</p>
        ) : rows.length === 0 ? (
          topic ? (
            <div className="surface flex flex-wrap items-center justify-between gap-3 p-5" data-testid="library-empty">
              <p className="text-sm text-muted-foreground">{emptyText(filter, topicName)}</p>
              <Button size="sm" variant="outline" onClick={clearFilters} data-testid="library-clear-filters">
                {filter === 'all' ? 'Clear topic' : 'Clear filters'}
              </Button>
            </div>
          ) : (
            <p className="surface p-5 text-sm text-muted-foreground" data-testid="library-empty">{emptyText(filter, null)}</p>
          )
        ) : network ? (
          <Suspense
            fallback={
              <div
                className="dot-grid grid place-items-center rounded-lg border border-border text-sm text-muted-foreground"
                style={{ height: constellationHeight(network.papers.length) }}
                data-testid="library-constellation-loading"
              >
                Loading…
              </div>
            }
          >
            <TopicConstellation network={network} countsReady={countsReady} />
          </Suspense>
        ) : groups ? (
          <div className="grid gap-5">
            {groups.map((g, i) => (
              <section key={g.workspaceId ?? ''} aria-labelledby={`${groupId}-${i}`} data-testid="library-group" data-workspace-id={g.workspaceId ?? ''}>
                <h2 id={`${groupId}-${i}`} className="label break-words pb-2" data-testid="library-group-name">{g.name}</h2>
                <ul className="surface divide-y divide-border">{g.rows.map((r) => renderRow(r, `${g.workspaceId}:`))}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="surface divide-y divide-border">{rows.map((r) => renderRow(r))}</ul>
        )}
      </div>
      <FinishDialog paper={finishing} open={!!finishing} onClose={() => setFinishing(null)} />
    </div>
  )
}

/** A Blueprint segmented control: one pressed button per option. */
function Segmented<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  testId,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (next: T) => void
  testId?: string
}) {
  return (
    <div className="flex w-fit gap-1 rounded-[7px] border border-border bg-surface-2 p-[3px]" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn('press cursor-pointer rounded-[3px] border border-transparent px-3 py-1 text-sm font-medium', value === o ? 'border-transparent bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-muted-foreground hover:text-foreground')}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  )
}

/**
 * The topic filter: a button that opens a searchable list of the topics in
 * the reader's papers, each with how many papers use it. The search box is a
 * combobox: arrow keys move through the list, Enter picks, Esc closes.
 */
function TopicPicker({
  topics,
  value,
  loading,
  onChange,
  triggerRef,
}: {
  topics: TopicCount[]
  value: string | null
  loading: boolean
  onChange: (key: string) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const listId = useId()
  const matches = useMemo(() => matchTopics(topics, query), [topics, query])
  const optionId = (i: number) => `${listId}-${i}`

  const openChange = (next: boolean) => {
    setOpen(next)
    setQuery('')
    setActive(-1)
  }
  const pick = (key: string) => {
    onChange(key)
    openChange(false)
  }
  const moveTo = (i: number) => {
    setActive(i)
    document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!matches.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(active < matches.length - 1 ? active + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(active > 0 ? active - 1 : matches.length - 1)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(matches[active].key)
    }
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          // As tall and as round as the segmented controls beside it.
          <Button ref={triggerRef} variant="outline" className="h-[38px] rounded-[7px] px-3" aria-label="Filter by topic" data-testid="library-topic-open">
            Topic <ChevronDownIcon size={14} weight={2} />
          </Button>
        }
      />
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-2" aria-label="Filter by topic" data-testid="library-topic-picker">
        <SearchInput
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(e.target.value.trim() ? 0 : -1)
          }}
          onClear={() => {
            setQuery('')
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search topics"
          aria-label="Search topics"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && matches[active] ? optionId(active) : undefined}
          data-testid="library-topic-search"
        />
        {loading ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground">Loading topics…</p>
        ) : !topics.length ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground">Your papers have no topics yet. A paper's topics appear once it is analyzed.</p>
        ) : !matches.length ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground" role="status">No topics match “{query.trim()}”.</p>
        ) : null}
        <ul id={listId} role="listbox" aria-label="Topics in your papers" className={cn('max-h-72 overflow-y-auto', matches.length > 0 && !loading && 'mt-2')}>
          {!loading &&
            matches.map((t, i) => {
              const current = t.key === value
              return (
                <li
                  key={t.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-label={`${t.name}, ${plural(t.count, 'paper', 'papers')}${current ? ', current filter' : ''}`}
                  data-topic-key={t.key}
                  data-testid="library-topic-option"
                  onClick={() => pick(t.key)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-[3px] px-2 py-1.5 text-sm', i === active && 'bg-accent')}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <CheckIcon size={14} className={cn('flex-none text-primary', !current && 'invisible')} />
                    <span className={cn('min-w-0 truncate', current && 'font-medium text-foreground')}>{t.name}</span>
                  </span>
                  <span className="flex-none font-mono text-[11px] tabular-nums text-muted-foreground">{t.count}</span>
                </li>
              )
            })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One paper. A failed analysis is not a readable paper: it shows the failure
 * and Retry (the paper window's retry path) in place of the counts and Mark
 * finished. A paper being analyzed says so until it is ready.
 */
function LibraryRow({
  row: r,
  paper,
  total,
  known,
  countsReady,
  onFinish,
}: {
  row: RecordData<RoadmapData>
  paper: RecordData<PaperData> | undefined
  total: number
  known: number
  countsReady: boolean
  onFinish: () => void
}) {
  const status = paper?.data.status
  const failed = status === 'failed'
  const analyzing = status === 'queued' || status === 'processing'
  const { retry, retrying, error } = useRetryPaper(paper?.recordId)
  return (
    <li
      className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_7rem] md:items-center"
      data-testid="library-row"
      data-status={r.data.status}
      data-paper-status={status ?? ''}
      data-arxiv={r.data.arxivId}
    >
      <div className="min-w-0">
        <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="font-medium hover:text-primary">{r.data.title || r.data.arxivId}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">arXiv {r.data.arxivId}</span>
          {r.data.lastOpenedAt ? <span>Opened {new Date(r.data.lastOpenedAt).toLocaleDateString()}</span> : null}
          {r.data.status === 'finished' && <Chip tone="known">Finished</Chip>}
        </div>
      </div>
      {failed ? (
        <div className="text-xs" data-testid="library-failed">
          <span className="text-learning">Analysis failed</span>
          {error && <p role="alert" className="mt-0.5 text-destructive">{error}</p>}
        </div>
      ) : analyzing ? (
        <div className="text-xs text-primary" data-testid="library-analyzing">Analyzing…</div>
      ) : (
        <div className="text-xs text-muted-foreground">
          <div className="mb-1 flex justify-between tabular-nums" data-testid="library-known">
            <span>Concepts known</span>
            <b className="font-semibold text-foreground">{countsReady ? `${known} / ${total}` : '…'}</b>
          </div>
          <Meter value={total ? known / total : 0} />
        </div>
      )}
      <div>
        {failed ? (
          <Button size="sm" variant="outline" loading={retrying} onClick={retry} data-testid="library-retry">Retry</Button>
        ) : analyzing ? null : r.data.status === 'finished' ? (
          <ReadAgainButton paperId={r.data.paperId} size="sm" variant="outline" testId="library-read-again" />
        ) : (
          <Button size="sm" variant="ghost" disabled={!paper} onClick={onFinish} data-testid="library-finish">Mark finished</Button>
        )}
      </div>
    </li>
  )
}
