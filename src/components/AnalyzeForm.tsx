/**
 * Paste an arXiv link or id and start (or open) its analysis. With a
 * workspaceId, the paper also becomes that workspace's current target.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { Button, Input } from './ui'
import { actions } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'
import { SignInOverlay } from './SignInOverlay'

export function AnalyzeForm({
  workspaceId,
  placeholder,
  initialValue = '',
  stay,
  onAdded,
}: {
  workspaceId?: string
  placeholder?: string
  /** Prefills the input, e.g. with the id of a paper that is not analyzed yet. */
  initialValue?: string
  /** Stay on the current page after adding (workspace view) instead of opening the paper. */
  stay?: boolean
  onAdded?: (arxivId: string) => void
}) {
  const { isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isSignedIn) return setShowAuth(true)
    if (busy) return
    if (!input.trim()) return setError('Paste an arXiv link or id first.')
    setBusy(true)
    setError('')
    const r = await actions.analyzePaper(input, workspaceId)
    setBusy(false)
    if (!r.success) return setError(r.error)
    setInput('')
    onAdded?.(r.data.arxivId)
    if (!stay) navigate(`/p/${arxivSlug(r.data.arxivId)}`)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="analyze-form">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder ?? 'arXiv link or id, e.g. 2611.29224'}
          aria-label="arXiv link or id"
          data-testid="analyze-input"
        />
        <Button type="submit" loading={busy} data-testid="analyze-submit">
          {workspaceId ? 'Add paper' : 'Open paper'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="analyze-error">
          {error}
        </p>
      )}
      {showAuth && <SignInOverlay onClose={() => setShowAuth(false)} />}
    </form>
  )
}
