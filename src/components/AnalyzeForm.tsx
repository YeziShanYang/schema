/**
 * Paste an arXiv link or id and start (or open) its analysis. With a
 * workspaceId, the paper also becomes that workspace's current target.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button, Input } from './ui'
import { actions } from '../lib/actions-client'
import { arxivSlug } from '../lib/arxiv'

export function AnalyzeForm({ workspaceId, placeholder }: { workspaceId?: string; placeholder?: string }) {
  const { isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isSignedIn) return setShowAuth(true)
    if (!input.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await actions.analyzePaper(input, workspaceId)
    setBusy(false)
    if (!r.success) return setError(r.error)
    navigate(`/p/${arxivSlug(r.data.arxivId)}`)
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
          Analyze
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="analyze-error">
          {error}
        </p>
      )}
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </form>
  )
}
