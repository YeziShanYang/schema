/**
 * App chrome for every page under (app)/.
 *
 * Signed in: a 232px sidebar (Add, the Home, Library and Knowledge pages,
 * workspaces, recent papers, then the concepts-learned count, daily allowance
 * and account) beside the page; on narrow screens the sidebar
 * becomes a sheet behind a menu button. The sheet takes focus while open,
 * Esc closes it, and focus returns to the menu button. Signed out: a slim
 * top bar with the brand and sign-in. A page banner with its own Sign in
 * (the demo banner) hides the top bar's while it is on screen
 * (useHideTopSignIn), so only one shows.
 *
 * Keep the data-testid hooks (app-navigation, nav-sign-in-button,
 * nav-user-name, nav-user-email); the shipped specs use them.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { signOut, useAuthProfileReady } from 'deepspace'
import { cn, plural } from '@/lib/utils'
import { Button, buttonVariants } from './ui'
import { AddButton } from './AddDialog'
import { SignInOverlay } from './SignInOverlay'
import { CloseIcon, MarkIcon, MenuIcon } from './icons'
import { useConceptKnowledge, useRoadmaps } from '../hooks/useReader'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useAllowance, useRefreshAllowanceOnSettle } from '../hooks/useAllowance'
import { arxivSlug } from '../lib/arxiv'
import { APP_DISPLAY_NAME } from '../constants'
import { FOCUSABLE, isTopOverlay, pushOverlay, trapTab } from '../lib/overlays'

/** The app's own pages, listed under Add in the sidebar. */
const PAGES = [
  { to: '/home', label: 'Home' },
  { to: '/library', label: 'Library' },
  { to: '/knowledge', label: 'Knowledge' },
]

const TopSignIn = createContext<(hidden: boolean) => void>(() => {})

/** Hides the signed-out top bar's Sign in while `ref`, a banner with its own, is on screen below the 48px bar. */
export function useHideTopSignIn(ref: RefObject<HTMLElement | null>, active: boolean) {
  const setHidden = useContext(TopSignIn)
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const io = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting), { rootMargin: '-48px 0px 0px 0px' })
    io.observe(el)
    return () => {
      io.disconnect()
      setHidden(false)
    }
  }, [ref, active, setHidden])
}

function Brand({ to = '/home' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded px-2 py-0.5 text-[17px] font-semibold tracking-[-0.01em] text-foreground">
      <MarkIcon size={18} className="text-primary" />
      {APP_DISPLAY_NAME}
    </Link>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuthProfileReady({ requireUser: true })
  const workspaces = useWorkspaces()
  const roadmaps = useRoadmaps()
  const knowledge = useConceptKnowledge()
  const { allowance } = useAllowance()
  const [menuOpen, setMenuOpen] = useState(false)

  const knownCount = knowledge.rows.filter((r) => r.data.status === 'known' && !r.data.stale).length
  const a = allowance?.analyze

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded border border-transparent px-2 py-[7px] text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out',
      isActive ? 'bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-foreground hover:bg-[color-mix(in_oklab,var(--color-foreground)_5%,transparent)]',
    )

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 px-3 py-[18px]" data-testid="app-navigation">
      <div className="px-0 pb-3"><Brand /></div>
      <AddButton className="w-full justify-start" />

      <nav aria-label="Pages" className="flex shrink-0 flex-col pt-2">
        <ul className="flex flex-col gap-0.5" data-testid="sidebar-pages">
          {PAGES.map((pg) => (
            <li key={pg.to}>
              <NavLink to={pg.to} end className={itemClass} onClick={onNavigate} data-testid={`nav-${pg.label.toLowerCase()}`}>
                {pg.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* A long workspace list scrolls inside its own section, so Recent papers and the footer stay in view. */}
      <nav aria-label="Workspaces" className="flex min-h-[7.5rem] flex-col">
        <div className="label px-2 pb-1.5 pt-3">Workspaces</div>
        <ul className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 py-px" data-testid="sidebar-workspaces">
          {workspaces.rows.map((w) => (
            <li key={w.recordId}>
              <NavLink to={`/w/${w.recordId}`} className={itemClass} onClick={onNavigate}>
                <span className="truncate">{w.data.name}</span>
                <small className="shrink-0 text-xs text-faint tabular-nums">
                  {workspaces.papersOf(w.recordId).length ? plural(workspaces.papersOf(w.recordId).length, 'paper', 'papers') : 'new'}
                </small>
              </NavLink>
            </li>
          ))}
          {workspaces.rows.length === 0 && <li className="px-2 text-[13px] text-faint">No workspaces yet.</li>}
        </ul>
      </nav>

      <nav aria-label="Recent papers" className="flex shrink-0 flex-col">
        <div className="label px-2 pb-1.5 pt-3">Recent papers</div>
        {roadmaps.rows.length === 0 ? (
          <p className="px-2 text-[13px] text-faint">Papers you open show up here.</p>
        ) : (
          <ul className="flex flex-col" data-testid="sidebar-recent">
            {roadmaps.rows.slice(0, 8).map((r) => (
              <li key={r.recordId}>
                <NavLink
                  to={`/p/${arxivSlug(r.data.arxivId)}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'block truncate rounded px-2 py-1.5 text-[13px] transition-[background-color,color] duration-150 ease-out',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-[color-mix(in_oklab,var(--color-foreground)_4%,transparent)] hover:text-foreground',
                    )
                  }
                >
                  {r.data.title || r.data.arxivId}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border px-2 pt-2.5 text-[13px] text-muted-foreground">
        <Link to="/knowledge" onClick={onNavigate} className="flex items-center justify-between rounded transition-[color] duration-150 ease-out hover:text-foreground" data-testid="sidebar-knowledge">
          <span>Concepts learned</span>
          <b className="font-semibold text-foreground tabular-nums">{knownCount}</b>
        </Link>
        <div className="flex items-center justify-between" data-testid="sidebar-allowance" data-remaining={a?.remaining ?? ""} title="New papers you can start in a rolling 24 hours. Papers someone already analyzed are free.">
          <span>New papers today</span>
          <span className="tabular-nums">{a ? <><b className="font-semibold text-foreground">{a.remaining}</b> of {a.used + a.remaining} left</> : '…'}</span>
        </div>
        {user && (
          <div className="relative">
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="press mt-1 flex w-full cursor-pointer items-center gap-2 rounded py-1 text-left hover:text-foreground"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] text-primary">
                {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
              </span>
              <span data-testid="nav-user-name" className="truncate text-foreground">{user.name || user.email}</span>
            </button>
            {menuOpen && (
              <div className="surface absolute bottom-full left-0 z-20 mb-1 w-full p-2 shadow-[var(--shadow-ring-hi)]">
                <div data-testid="nav-user-email" className="truncate px-1 pb-2 text-xs text-muted-foreground">{user.email}</div>
                <Link
                  to="/knowledge"
                  onClick={() => {
                    setMenuOpen(false)
                    onNavigate?.()
                  }}
                  className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'w-full justify-start')}
                  data-testid="account-knowledge"
                >
                  Knowledge
                </Link>
                <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => signOut()}>Sign out</Button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuthProfileReady({ requireUser: true })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [hideSignIn, setHideSignIn] = useState(false)
  const location = useLocation()
  // "New papers today" and every other allowance count follow a paper whose analysis fails (refunded) or finishes.
  useRefreshAllowanceOnSettle()

  useEffect(() => setSheetOpen(false), [location.pathname])

  // The open sheet is an overlay layer: focus moves into the panel (not the backdrop), Esc closes it, and focus
  // returns to the menu button.
  const menuButton = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sheetOpen) return
    const layer = {}
    const pop = pushOverlay(layer)
    sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopOverlay(layer)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setSheetOpen(false)
      } else if (e.key === 'Tab' && sheetRef.current) {
        trapTab(e, sheetRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      pop()
      menuButton.current?.focus()
    }
  }, [sheetOpen])

  if (isLoaded && !isSignedIn) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header data-testid="app-navigation" className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <Brand to="/" />
          {!hideSignIn && (
            <button
              type="button"
              data-testid="nav-sign-in-button"
              onClick={() => setShowAuth(true)}
              className="press h-[30px] cursor-pointer rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,black)]"
            >
              Sign in
            </button>
          )}
        </header>
        <main className="flex-1">
          <TopSignIn.Provider value={setHideSignIn}>{children}</TopSignIn.Provider>
        </main>
        {showAuth && <SignInOverlay onClose={() => setShowAuth(false)} />}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      {/* The document scrolls; the sidebar stays in view beside it. */}
      <aside className="sticky top-0 hidden h-screen min-w-0 overflow-y-auto overscroll-contain border-r border-border bg-surface-2 md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-card px-3 md:hidden">
        <Brand />
        <button ref={menuButton} type="button" aria-label="Open menu" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)} className="press grid size-[34px] cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
          <MenuIcon size={18} />
        </button>
      </header>

      {sheetOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="backdrop absolute inset-0 cursor-default bg-[rgba(15,23,42,0.25)]" onClick={() => setSheetOpen(false)} />
          <div ref={sheetRef} className="sheet absolute inset-y-0 left-0 w-[min(300px,86vw)] overflow-y-auto overscroll-contain border-r border-border bg-surface-2 shadow-[var(--shadow-ring-hi)]">
            <button type="button" aria-label="Close menu" onClick={() => setSheetOpen(false)} className="press absolute right-2 top-3 grid size-[30px] cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent">
              <CloseIcon size={16} />
            </button>
            <SidebarContent onNavigate={() => setSheetOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0">{children}</main>
    </div>
  )
}
