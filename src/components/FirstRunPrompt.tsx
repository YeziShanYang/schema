/**
 * One-time prompt for a signed-in reader who has checked nothing and has an
 * empty profile: points to the starter topics, which papers then point out
 * on the concepts that use them. Dismissal is kept in localStorage (frontend only).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useConceptKnowledge, useProfile } from '../hooks/useReader'
import { CloseIcon } from './icons'

const KEY = 'schema:first-run-dismissed'

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function FirstRunPrompt({ className }: { className?: string }) {
  const profile = useProfile()
  const concepts = useConceptKnowledge()
  const [hidden, setHidden] = useState(dismissed)
  if (hidden || profile.status !== 'ready' || concepts.status !== 'ready' || profile.rows.length > 0 || concepts.rows.length > 0) return null
  return (
    <div className={'flex items-start justify-between gap-3 rounded-lg border border-primary bg-accent-soft p-3.5 ' + (className ?? '')} data-testid="first-run" role="note">
      <div className="text-sm">
        <p className="font-semibold">Tell Schema what you already know</p>
        <p className="mt-0.5 text-muted-foreground">
          Tick the topics you know on the <Link to="/knowledge#starter" className="text-primary hover:underline">knowledge page</Link>. Papers that use them will say so on the concept, and you check it off with one click.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem(KEY, '1')
          } catch {
            // not persisted; it shows again next visit
          }
        }}
        className="press grid size-[26px] shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-card"
        data-testid="first-run-dismiss"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
