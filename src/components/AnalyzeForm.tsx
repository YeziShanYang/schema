/**
 * The "Open a paper" box. Paste an arXiv link or id and open its paper,
 * through the same look-up as the Add window (peekPaper). A paper that
 * already exists (ready, running or failed) opens at once and uses no daily
 * slot. A new one opens the Add window's paper path with the look-up done, so
 * the reader sees the same preview, workspace choice and daily-limit notice
 * before anything is spent. With a workspaceId, that workspace is the one
 * preselected there.
 *
 * Text that is not a link or id searches the analyzed papers by title,
 * author and id (lib/paper-search) and lists the best matches under the box,
 * as an ARIA combobox. Picking one submits its arXiv id, exactly as if the
 * reader had pasted it. Submitting the words themselves asks the reader to
 * pick a result, or says nothing matches, without calling the server.
 */

import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { cn, plural } from '@/lib/utils'
import { Button, Input } from './ui'
import { Chip } from './blueprint'
import { actions, type PaperPeek } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'
import { toMs } from '../lib/cap'
import { isNameSearch, matchPapers, shortAuthors } from '../lib/paper-search'
import type { PaperData } from '../types'
import { AddDialog } from './AddDialog'
import { SignInOverlay } from './SignInOverlay'

export function AnalyzeForm({
  workspaceId,
  placeholder,
  initialValue = '',
}: {
  workspaceId?: string
  placeholder?: string
  /** Prefills the input, e.g. with the id of a paper that is not analyzed yet. */
  initialValue?: string
}) {
  const { isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  // A new paper's look-up, handed to the Add window.
  const [found, setFound] = useState<{ input: string; peek: PaperPeek } | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  // The search list: open while the box has focus and holds a name search; `active` is the highlighted option.
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const optionId = (i: number) => `${listId}-${i}`
  // The app shell keeps this same query open (useRefreshAllowanceOnSettle), so the search adds no subscription.
  const papers = useQuery<PaperData>('papers', { limit: 2000 })
  const nameSearch = isNameSearch(input)
  // Newest first, so equally good matches list the paper analyzed last on top. Sorted only while searching.
  const byRecent = useMemo(
    () => (nameSearch ? [...papers.records].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt)).map((r) => r.data) : []),
    [nameSearch, papers.records],
  )
  const matches = useMemo(() => (nameSearch ? matchPapers(byRecent, input) : []), [nameSearch, byRecent, input])
  const loading = papers.status === 'loading' && !papers.records.length
  const showList = listOpen && nameSearch

  function closeList() {
    setListOpen(false)
    setActive(-1)
  }

  async function open(value: string) {
    if (!isSignedIn) return setShowAuth(true)
    if (busy) return
    if (!value.trim()) return setError('Type a title or paste an arXiv link first.')
    setBusy(true)
    setError('')
    const r = await actions.peekPaper(value)
    setBusy(false)
    if (!r.success) return setError(r.error)
    if (r.data.status !== 'new') return navigate(`/p/${arxivSlug(r.data.arxivId)}`)
    setFound({ input: value, peek: r.data })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    // Words, not a link: only a picked result can open, so say what to do instead of asking the server.
    // While the papers are still loading, the list will show the results or say nothing matches.
    if (nameSearch) {
      if (loading || matches.length) {
        setListOpen(true)
        return setError('Pick a paper from the list, or paste an arXiv link.')
      }
      closeList()
      return setError('No analyzed paper matches. Paste its arXiv link to analyze it.')
    }
    closeList()
    void open(input)
  }

  function pick(arxivId: string) {
    setInput(arxivId)
    closeList()
    void open(arxivId)
  }

  function moveTo(i: number) {
    setActive(i)
    document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!nameSearch) return
    const n = matches.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      if (!showList) {
        setListOpen(true)
        if (n) moveTo(down ? 0 : n - 1)
      } else if (n) {
        moveTo(down ? (active + 1) % n : active <= 0 ? n - 1 : active - 1)
      }
    } else if (e.key === 'Enter' && showList && matches[active]) {
      e.preventDefault()
      pick(matches[active].arxivId)
    } else if (e.key === 'Escape' && showList) {
      // Closes only the list; the text stays.
      e.preventDefault()
      e.stopPropagation()
      closeList()
    }
  }

  // Read out by screen readers as the list changes.
  const status = !showList || loading ? '' : matches.length ? `${plural(matches.length, 'analyzed paper', 'analyzed papers')} found.` : 'No analyzed paper matches.'

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-2" data-testid="analyze-form">
        <div className="relative">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError('')
                setListOpen(true)
                setActive(-1)
              }}
              onFocus={() => setListOpen(true)}
              // Options keep focus here (they take no focus on mousedown), so a blur means focus or a click went elsewhere.
              onBlur={closeList}
              onKeyDown={onKeyDown}
              placeholder={placeholder ?? 'Title or arXiv link'}
              aria-label="Paper title, or arXiv link or id"
              role="combobox"
              // The listbox is hidden when nothing matches; the live region below says so instead.
              aria-expanded={showList && matches.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList && matches[active] ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              data-testid="analyze-input"
            />
            <Button ref={submitRef} type="submit" loading={busy} data-testid="analyze-submit">
              {workspaceId ? 'Add paper' : 'Open paper'}
            </Button>
          </div>
          <div
            hidden={!showList}
            className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
            data-testid="paper-search"
            // Clicks inside the list leave focus in the box.
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul id={listId} role="listbox" aria-label="Analyzed papers" hidden={!matches.length} className="max-h-[min(24rem,60vh)] overflow-y-auto p-1">
              {matches.map((p, i) => {
                const authors = shortAuthors(p.authors)
                return (
                  <li
                    key={p.arxivId}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    data-testid="paper-search-option"
                    data-arxiv={p.arxivId}
                    onClick={() => pick(p.arxivId)}
                    onMouseMove={() => active !== i && setActive(i)}
                    className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-[3px] px-2.5 py-1.5', i === active && 'bg-accent')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium text-foreground">{p.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {authors && `${authors} · `}
                        <span className="font-mono tabular-nums">{p.arxivId}</span>
                      </span>
                    </span>
                    <Chip>Free</Chip>
                  </li>
                )
              })}
            </ul>
            {loading ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">Loading analyzed papers…</p>
            ) : (
              !matches.length && (
                <p className="px-3 py-2.5 text-sm text-muted-foreground" data-testid="paper-search-empty">
                  No analyzed paper matches. Paste its arXiv link to analyze it.
                </p>
              )
            )}
          </div>
          <span className="sr-only" role="status">
            {status}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="analyze-error">
            {error}
          </p>
        )}
      </form>
      {/* Outside the form: React events bubble through portals, so the window's own submits would reach this form. */}
      <AddDialog open={!!found} onClose={() => setFound(null)} workspaceId={workspaceId} initial={found ?? undefined} returnFocus={() => submitRef.current} />
      {showAuth && <SignInOverlay onClose={() => setShowAuth(false)} />}
    </>
  )
}
