/**
 * Library: the papers in the reader's Library (src/lib/membership.ts: in a
 * workspace, saved, or started and never removed; opening a paper alone never
 * adds it), with progress, the workspaces each paper is in and last opened.
 * Filtered by in progress or finished, by a topic from the reader's own
 * papers and by a workspace (or "Not in a workspace"), and sorted by last
 * opened or grouped by workspace. The sort, the topic, the workspace and the
 * view are kept in the URL query
 * (?sort=workspace&topic=<key>&ws=<id>|none&view=constellation); the status
 * filter is not. Each row names its workspaces as links, with the placement
 * control beside them. Finished papers can be read again, and a failed
 * analysis can be retried from its row.
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
import { PlacementControl } from '../../../components/PlacementControl'
import { checkedPerPaper, useConceptKnowledge, useTopics } from '../../../hooks/useReader'
import { useLibrary, type LibraryEntry } from '../../../hooks/useLibrary'
import { useRetryPaper } from '../../../hooks/useRetryPaper'
import { useWorkspaces } from '../../../hooks/useWorkspaces'
import { arxivSlug } from '../../../lib/arxiv'
import { emptyText, filterRows, groupByWorkspace, libraryQuery, matchTopics, NO_WORKSPACE, parseLibraryQuery, topicCounts, UNFILED, workspaceCounts } from '../../../lib/library'
import type { LibraryQuery, LibrarySort, LibraryView, StatusFilter, TopicCount } from '../../../lib/library'
import { constellationHeight, libraryNetwork } from '../../../lib/library-network'
import type { PaperData } from '../../../types'

const STATUS_LABEL: Record<StatusFilter, string> = { all: 'All', reading: 'In progress', finished: 'Finished' }
const SORT_LABEL: Record<LibrarySort, string> = { opened: 'Last opened', workspace: 'Workspace' }
const VIEW_LABEL: Record<LibraryView, string> = { list: 'List', constellation: 'Constellation' }
/** The constellation needs a column at least this wide; below it the list shows, as the floating graphs stack. */
const CONSTELLATION_MIN_WIDTH = 640

const TopicConstellation = lazy(() => import('../../../components/graph/TopicConstellation'))

export default function LibraryPage() {
  const library = useLibrary()
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

  // Sort, topic, workspace and view live in the URL. Changes replace the entry, so Back leaves the Library instead of undoing a filter.
  const [searchParams, setSearchParams] = useSearchParams()
  const { sort, topic, ws, view } = parseLibraryQuery(searchParams)
  const updateQuery = useCallback(
    (patch: Partial<LibraryQuery>) => setSearchParams((prev) => libraryQuery(prev, patch), { replace: true }),
    [setSearchParams],
  )

  const entries = library.entries
  const topicKeysOf = useCallback((paperId: string) => paperById.get(paperId)?.data.topicKeys, [paperById])
  const workspaceIdsOf = useCallback((paperId: string) => library.byPaper.get(paperId)?.data.workspaceIds ?? [], [library.byPaper])
  const topicNames = useMemo(() => new Map([...topicsByKey].map(([key, r]) => [key, r.data.name])), [topicsByKey])
  const topics = useMemo(
    () => topicCounts(entries.map((e) => ({ topicKeys: topicKeysOf(e.data.paperId) })), topicNames),
    [entries, topicKeysOf, topicNames],
  )
  const topicName = topic ? topicNames.get(topic) || topic : null
  const { rows: workspaceRows, papersOf, byId: workspaceById } = workspaces
  const workspaceOptions = useMemo(
    () => workspaceCounts(entries.map((e) => e.data), workspaceRows.map((w) => ({ id: w.recordId, name: w.data.name }))),
    [entries, workspaceRows],
  )
  const wsName = ws === UNFILED ? NO_WORKSPACE : ws ? workspaceById.get(ws)?.data.name ?? 'a removed workspace' : null

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

  const rows = useMemo(
    () => filterRows(entries, { status: filter, topic, workspace: ws }, topicKeysOf, workspaceIdsOf),
    [entries, filter, topic, ws, topicKeysOf, workspaceIdsOf],
  )
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
  // Membership needs the roadmaps, the workspaces and the checkmarks; a topic needs the papers' topic keys.
  // The constellation draws topics, so it waits for the papers too. Each waits only for its first load: a
  // reconnect sets the queries back to loading with their last records, and the page keeps showing those
  // (so a selection in the constellation survives it).
  const [membershipLoaded, setMembershipLoaded] = useState(false)
  if (!membershipLoaded && library.status !== 'loading') setMembershipLoaded(true)
  const [papersLoaded, setPapersLoaded] = useState(false)
  if (!papersLoaded && papers.status !== 'loading') setPapersLoaded(true)
  const loading = !membershipLoaded || ((!!topic || constellation) && !papersLoaded)

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
  const wsButton = useRef<HTMLButtonElement>(null)
  const clearTopic = () => {
    updateQuery({ topic: null })
    topicButton.current?.focus()
  }
  const clearWorkspace = () => {
    updateQuery({ ws: null })
    wsButton.current?.focus()
  }
  const clearFilters = () => {
    setFilter('all')
    updateQuery({ topic: null, ws: null })
    ;(topic ? topicButton : wsButton).current?.focus()
  }
  const clearLabel = filter === 'all' && !(topic && ws) ? (topic ? 'Clear topic' : 'Clear workspace') : 'Clear filters'

  const groupId = useId()
  const renderRow = (r: LibraryEntry, keyPrefix = '') => {
    const paper = paperById.get(r.data.paperId)
    const total = paper?.data.conceptCount || 0
    return (
      <LibraryRow
        key={keyPrefix + r.id}
        row={r}
        paper={paper}
        total={total}
        known={Math.min(checked.get(r.data.paperId) ?? 0, total)}
        countsReady={countsReady}
        workspaceName={(id) => workspaceById.get(id)?.data.name ?? ''}
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
      {/* The constellation gets the page's full width (to 1280px); the list keeps a narrower column. */}
      <div ref={column} className={cn('grid gap-4 px-5 py-6 md:px-7', network && rows.length > 0 && !loading ? 'max-w-7xl' : 'max-w-5xl')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="library-controls">
          <Segmented label="Filter papers" options={['all', 'reading', 'finished'] as const} labels={STATUS_LABEL} value={filter} onChange={setFilter} />
          {!constellation && (
            <div className="flex items-center gap-2">
              <span className="label" aria-hidden="true">Sort</span>
              <Segmented label="Sort papers" options={['opened', 'workspace'] as const} labels={SORT_LABEL} value={sort} onChange={(s) => updateQuery({ sort: s })} testId="library-sort" />
            </div>
          )}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <FilterPicker
              buttonText="Topic"
              label="Filter by topic"
              searchLabel="Search topics"
              listLabel="Topics in your papers"
              testId="library-topic"
              options={topics}
              value={topic}
              loading={papers.status === 'loading'}
              emptyNote="Your papers have no topics yet. A paper's topics appear once it is analyzed."
              noun="topics"
              onChange={(key) => updateQuery({ topic: key })}
              triggerRef={topicButton}
            />
            {topic && <FilterChip text={`Topic: ${topicName}`} clearLabel={`Clear topic ${topicName}`} onClear={clearTopic} testId="library-topic" />}
            <FilterPicker
              buttonText="Workspace"
              label="Filter by workspace"
              searchLabel="Search workspaces"
              listLabel="Your workspaces"
              testId="library-ws"
              options={workspaceOptions}
              value={ws}
              loading={!workspaces.ready && workspaces.status !== 'error'}
              emptyNote=""
              noun="workspaces"
              onChange={(key) => updateQuery({ ws: key })}
              triggerRef={wsButton}
            />
            {ws && (
              <FilterChip
                text={ws === UNFILED ? NO_WORKSPACE : `Workspace: ${wsName}`}
                clearLabel={ws === UNFILED ? 'Clear the Not in a workspace filter' : `Clear workspace ${wsName}`}
                onClear={clearWorkspace}
                testId="library-ws"
              />
            )}
          </div>
        </div>

        {loading ? (
          <p className="surface p-5 text-sm text-muted-foreground" data-testid="library-loading">Loading…</p>
        ) : rows.length === 0 ? (
          topic || ws ? (
            <div className="surface flex flex-wrap items-center justify-between gap-3 p-5" data-testid="library-empty">
              <p className="text-sm text-muted-foreground">{emptyText(filter, topicName, ws === UNFILED ? 'unfiled' : ws ? { name: wsName ?? '' } : null)}</p>
              <Button size="sm" variant="outline" onClick={clearFilters} data-testid="library-clear-filters">
                {clearLabel}
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

/** The chip that names a set filter, with a button that clears it. */
function FilterChip({ text, clearLabel, onClear, testId }: { text: string; clearLabel: string; onClear: () => void; testId: string }) {
  return (
    <span
      className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-0.5 rounded-[3px] border border-transparent bg-accent-soft pl-2.5 pr-0.5 text-[13px] text-primary"
      data-testid={`${testId}-chip`}
    >
      <span className="min-w-0 truncate">{text}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="press grid size-[26px] flex-none cursor-pointer place-items-center rounded-[3px] outline-none hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] focus-visible:ring-[3px] focus-visible:ring-ring/70"
        data-testid={`${testId}-clear`}
      >
        <CloseIcon size={14} weight={2} />
      </button>
    </span>
  )
}

/**
 * A filter button that opens a searchable list of options, each with how many
 * of the reader's papers it covers: the topics in their papers, or their
 * workspaces and "Not in a workspace". The search box is a combobox: arrow
 * keys move through the list, Enter picks, Esc closes.
 */
function FilterPicker({
  buttonText,
  label,
  searchLabel,
  listLabel,
  testId,
  options,
  value,
  loading,
  emptyNote,
  noun,
  onChange,
  triggerRef,
}: {
  buttonText: string
  label: string
  searchLabel: string
  listLabel: string
  testId: string
  options: TopicCount[]
  value: string | null
  loading: boolean
  emptyNote: string
  noun: string
  onChange: (key: string) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const listId = useId()
  const matches = useMemo(() => matchTopics(options, query), [options, query])
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
          <Button ref={triggerRef} variant="outline" className="h-[38px] rounded-[7px] px-3" aria-label={label} data-testid={`${testId}-open`}>
            {buttonText} <ChevronDownIcon size={14} weight={2} />
          </Button>
        }
      />
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-2" aria-label={label} data-testid={`${testId}-picker`}>
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
          placeholder={searchLabel}
          aria-label={searchLabel}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && matches[active] ? optionId(active) : undefined}
          data-testid={`${testId}-search`}
        />
        {loading ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground">Loading {noun}…</p>
        ) : !options.length ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground">{emptyNote}</p>
        ) : !matches.length ? (
          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground" role="status">No {noun} match “{query.trim()}”.</p>
        ) : null}
        <ul id={listId} role="listbox" aria-label={listLabel} className={cn('max-h-72 overflow-y-auto', matches.length > 0 && !loading && 'mt-2')}>
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
                  data-key={t.key}
                  data-topic-key={t.key}
                  data-testid={`${testId}-option`}
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
 * One paper: title and meta, the workspaces it is in (links, or "No
 * workspace") with the placement control, the known meter, then the action.
 * From 1280px they sit on one line; between 768 and 1280 the workspaces go
 * under the title, and below 768 everything stacks. A failed analysis is
 * not a readable paper: it shows the failure and Retry (the paper window's
 * retry path) in place of the counts and Mark finished. A paper being
 * analyzed says so until it is ready.
 */
function LibraryRow({
  row: r,
  paper,
  total,
  known,
  countsReady,
  workspaceName,
  onFinish,
}: {
  row: LibraryEntry
  paper: RecordData<PaperData> | undefined
  total: number
  known: number
  countsReady: boolean
  workspaceName: (id: string) => string
  onFinish: () => void
}) {
  const status = paper?.data.status
  const failed = status === 'failed'
  const analyzing = status === 'queued' || status === 'processing'
  const { retry, retrying, error } = useRetryPaper(paper?.recordId)
  const title = r.data.title || paper?.data.title || r.data.arxivId
  const ref = useMemo(() => ({ paperId: r.data.paperId, arxivId: r.data.arxivId, title }), [r.data.paperId, r.data.arxivId, title])
  const wsIds = r.data.workspaceIds
  return (
    <li
      className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px_7rem] md:items-center xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_160px_7rem]"
      data-testid="library-row"
      data-status={r.data.status}
      data-paper-status={status ?? ''}
      data-arxiv={r.data.arxivId}
    >
      <div className="min-w-0 md:col-start-1 md:row-start-1">
        <Link to={`/p/${arxivSlug(r.data.arxivId)}`} className="font-medium hover:text-primary">{title}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">arXiv {r.data.arxivId}</span>
          {r.data.lastOpenedAt ? (
            <span>Opened {new Date(r.data.lastOpenedAt).toLocaleDateString()}</span>
          ) : r.data.savedAt ? (
            <span>Saved {new Date(r.data.savedAt).toLocaleDateString()}</span>
          ) : null}
          {r.data.status === 'finished' && <Chip tone="known">Finished</Chip>}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 md:col-start-1 md:row-start-2 xl:col-start-2 xl:row-start-1" data-testid="library-row-workspaces">
        {wsIds.length ? (
          <ul aria-label={`Workspaces holding ${title}`} className="flex min-w-0 flex-1 flex-wrap gap-1">
            {wsIds.map((id) => (
              <li key={id} className="min-w-0 max-w-full">
                <Link
                  to={`/w/${id}`}
                  className="block max-w-[13rem] truncate rounded-[3px] bg-accent-soft px-1.5 py-px text-[12px] leading-[18px] text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/70"
                  title={workspaceName(id)}
                  data-testid="library-workspace-chip"
                  data-workspace-id={id}
                >
                  {workspaceName(id) || 'Workspace'}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="library-no-workspace">No workspace</span>
        )}
        <PlacementControl papers={[ref]} trigger="icon" testId="library-place" />
      </div>
      {failed ? (
        <div className="text-xs md:col-start-2 md:row-span-2 md:row-start-1 xl:col-start-3 xl:row-span-1" data-testid="library-failed">
          <span className="text-learning">Analysis failed</span>
          {error && <p role="alert" className="mt-0.5 text-destructive">{error}</p>}
        </div>
      ) : analyzing ? (
        <div className="text-xs text-primary md:col-start-2 md:row-span-2 md:row-start-1 xl:col-start-3 xl:row-span-1" data-testid="library-analyzing">Analyzing…</div>
      ) : (
        <div className="text-xs text-muted-foreground md:col-start-2 md:row-span-2 md:row-start-1 xl:col-start-3 xl:row-span-1">
          <div className="mb-1 flex justify-between tabular-nums" data-testid="library-known">
            <span>Concepts known</span>
            <b className="font-semibold text-foreground">{countsReady ? `${known} / ${total}` : '…'}</b>
          </div>
          <Meter value={total ? known / total : 0} />
        </div>
      )}
      <div className="md:col-start-3 md:row-span-2 md:row-start-1 xl:col-start-4 xl:row-span-1">
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
