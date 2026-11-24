/**
 * App chrome for every page under (app)/.
 *
 * Signed in: a 232px sidebar (workspaces, recent papers, knowledge count,
 * daily allowance, account) beside the page; on narrow screens the sidebar
 * becomes a sheet behind a menu button. Signed out: a slim top bar with the
 * brand and sign-in.
 *
 * Keep the data-testid hooks (app-navigation, nav-sign-in-button,
 * nav-user-name, nav-user-email); the shipped specs use them.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady } from 'deepspace'
import { cn } from '@/lib/utils'
import { Button, Input, Modal, Textarea } from './ui'
import { CloseIcon, MarkIcon, MenuIcon, PlusIcon } from './icons'
import { useKnowledge, useRoadmaps } from '../hooks/useReader'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useAllowance } from '../hooks/useAllowance'
import { arxivSlug } from '../lib/arxiv'
import { APP_DISPLAY_NAME } from '../constants'

function Brand() {
  return (
    <Link to="/home" className="flex items-center gap-2 rounded px-2 py-0.5 text-[17px] font-semibold tracking-[-0.01em] text-foreground">
      <MarkIcon size={18} className="text-primary" />
      {APP_DISPLAY_NAME}
    </Link>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspaces = useWorkspaces()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give the workspace a name.')
    setBusy(true)
    setError('')
    try {
      const id = await workspaces.create(name, description)
      if (id) {
        setName('')
        setDescription('')
        onClose()
        navigate(`/w/${id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>New workspace</Modal.Title>
        <Modal.Description>A subject you are studying, such as Machine Learning or CS 229.</Modal.Description>
      </Modal.Header>
      <form onSubmit={submit} className="flex flex-col gap-3" data-testid="workspace-form">
        <label className="flex flex-col gap-1.5">
          <span className="label">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine Learning" aria-label="Workspace name" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">What you want to learn (optional)</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Representation learning and probing" aria-label="Workspace description" rows={3} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!workspaces.ready}>Create workspace</Button>
        </div>
      </form>
    </Modal>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuthProfileReady({ requireUser: true })
  const workspaces = useWorkspaces()
  const roadmaps = useRoadmaps()
  const knowledge = useKnowledge()
  const { allowance } = useAllowance()
  const [creating, setCreating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const knownCount = knowledge.rows.filter((r) => r.data.status === 'known').length
  const learningCount = knowledge.rows.length - knownCount
  const a = allowance?.analyze

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded border border-transparent px-2 py-[7px] text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out',
      isActive ? 'bg-card text-foreground shadow-[var(--shadow-ring)]' : 'text-foreground hover:bg-[color-mix(in_oklab,var(--color-foreground)_5%,transparent)]',
    )

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 px-3 py-[18px]" data-testid="app-navigation">
      <div className="px-0 pb-3.5"><Brand /></div>

      <nav aria-label="Workspaces" className="flex min-h-0 flex-col">
        <div className="label px-2 pb-1.5 pt-3">Workspaces</div>
        <ul className="flex flex-col gap-0.5" data-testid="sidebar-workspaces">
          {workspaces.rows.map((w) => (
            <li key={w.recordId}>
              <NavLink to={`/w/${w.recordId}`} className={itemClass} onClick={onNavigate}>
                <span className="truncate">{w.data.name}</span>
                <small className="shrink-0 text-xs text-faint tabular-nums">
                  {w.data.papers?.length ? plural(w.data.papers.length, 'paper', 'papers') : 'new'}
                </small>
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setCreating(true)} className="press flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-[7px] text-left text-sm text-muted-foreground hover:bg-[color-mix(in_oklab,var(--color-foreground)_5%,transparent)] hover:text-foreground" data-testid="new-workspace">
              <PlusIcon size={14} /> New workspace
            </button>
          </li>
        </ul>
      </nav>

      <nav aria-label="Recent papers" className="flex min-h-0 flex-col">
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
        <NavLink to="/library" onClick={onNavigate} className="mt-1 px-2 text-[13px] text-primary hover:underline">
          Library
        </NavLink>
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border px-2 pt-2.5 text-[13px] text-muted-foreground">
        <NavLink to="/knowledge" onClick={onNavigate} className="flex items-center justify-between rounded hover:text-foreground" data-testid="sidebar-knowledge">
          <span>Knowledge</span>
          <span className="tabular-nums">
            <b className="font-semibold text-foreground">{knownCount}</b> known
            {learningCount > 0 && <> · {learningCount} learning</>}
          </span>
        </NavLink>
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
                <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => signOut()}>Sign out</Button>
              </div>
            )}
          </div>
        )}
      </div>

      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuthProfileReady({ requireUser: true })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const location = useLocation()

  useEffect(() => setSheetOpen(false), [location.pathname])

  if (isLoaded && !isSignedIn) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <header data-testid="app-navigation" className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <Brand />
          <button
            type="button"
            data-testid="nav-sign-in-button"
            onClick={() => setShowAuth(true)}
            className="press h-[30px] cursor-pointer rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,black)]"
          >
            Sign in
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    )
  }

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="hidden min-w-0 border-r border-border bg-surface-2 md:block">
        <SidebarContent />
      </aside>

      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-3 md:hidden">
        <Brand />
        <button type="button" aria-label="Open menu" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)} className="press grid size-[34px] cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
          <MenuIcon size={18} />
        </button>
      </header>

      {sheetOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="backdrop absolute inset-0 cursor-default bg-[rgba(15,23,42,0.25)]" onClick={() => setSheetOpen(false)} />
          <div className="sheet absolute inset-y-0 left-0 w-[min(300px,86vw)] overflow-y-auto overscroll-contain border-r border-border bg-surface-2 shadow-[var(--shadow-ring-hi)]">
            <button type="button" aria-label="Close menu" onClick={() => setSheetOpen(false)} className="press absolute right-2 top-3 grid size-[30px] cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent">
              <CloseIcon size={16} />
            </button>
            <SidebarContent onNavigate={() => setSheetOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-h-0 min-w-0 overflow-y-auto">{children}</main>
    </div>
  )
}
