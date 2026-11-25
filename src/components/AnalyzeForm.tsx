/**
 * Paste an arXiv link or id and open its paper, through the same look-up as
 * the Add window (peekPaper). A paper that already exists (ready, running or
 * failed) opens at once and uses no daily slot. A new one opens the Add
 * window's paper path with the look-up done, so the reader sees the same
 * preview, workspace choice and daily-limit notice before anything is spent.
 * With a workspaceId, that workspace is the one preselected there.
 */

import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { Button, Input } from './ui'
import { actions, type PaperPeek } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'
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

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isSignedIn) return setShowAuth(true)
    if (busy) return
    if (!input.trim()) return setError('Paste an arXiv link or id first.')
    setBusy(true)
    setError('')
    const r = await actions.peekPaper(input)
    setBusy(false)
    if (!r.success) return setError(r.error)
    if (r.data.status !== 'new') return navigate(`/p/${arxivSlug(r.data.arxivId)}`)
    setFound({ input, peek: r.data })
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-2" data-testid="analyze-form">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder ?? 'e.g. 2611.29224'}
            aria-label="arXiv link or id"
            data-testid="analyze-input"
          />
          <Button ref={submitRef} type="submit" loading={busy} data-testid="analyze-submit">
            {workspaceId ? 'Add paper' : 'Open paper'}
          </Button>
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
