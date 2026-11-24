/**
 * The knowledge API a paper page uses: per-concept checkmarks plus hints.
 * Signed in, it reads the reader's checked concepts and profile topics.
 * Signed out (demo mode), checkmarks live in memory only: nothing is written
 * to the backend, reloading the page starts over, and there are no hints.
 */

import { useCallback, useMemo, useState } from 'react'
import { useAuth } from 'deepspace'
import type { KnowledgeStatus } from '../types'
import { buildHintIndex, conceptHint, type ConceptHint } from '../lib/hints'
import { useConceptKnowledge, useProfile, type ConceptKnowledgeApi, type ConceptRef } from './useReader'

export interface ReaderKnowledgeApi {
  ready: boolean
  isDemo: boolean
  /** By the concept's record id. */
  statusOf: (conceptId: string) => KnowledgeStatus | null
  isPending: (conceptId: string) => boolean
  set: ConceptKnowledgeApi['set']
  clear: (conceptId: string) => Promise<void>
  /** The note for a concept: checked in another paper, or in the profile. Callers show it only while the concept is unchecked. */
  hintFor: (concept: { conceptId: string; paperId: string; name: string; topicKey: string }) => ConceptHint | null
}

type DemoApi = Pick<ReaderKnowledgeApi, 'statusOf' | 'set' | 'clear'>

export function useDemoKnowledge(): DemoApi {
  const [known, setKnown] = useState<Set<string>>(() => new Set())
  const set = useCallback<DemoApi['set']>(async (c: ConceptRef) => {
    setKnown((prev) => new Set(prev).add(c.conceptId))
  }, [])
  const clear = useCallback(async (conceptId: string) => {
    setKnown((prev) => {
      const next = new Set(prev)
      next.delete(conceptId)
      return next
    })
  }, [])
  const statusOf = useCallback((conceptId: string) => (known.has(conceptId) ? 'known' : null), [known])
  return { statusOf, set, clear }
}

const noHint = () => null

/**
 * The knowledge API for the current visitor: the real rows when signed in,
 * the in-memory demo adapter when signed out. Every hook always runs so the
 * hook order never changes.
 */
export function useReaderKnowledge(): ReaderKnowledgeApi {
  const { isSignedIn, isLoaded } = useAuth()
  const concepts = useConceptKnowledge()
  const profile = useProfile()
  const demo = useDemoKnowledge()
  const isDemo = isLoaded && !isSignedIn

  // Most recently changed first, so a hint names the paper the reader checked it in last.
  const index = useMemo(() => {
    const checked = concepts.rows
      .filter((r) => r.data.status === 'known')
      .sort((a, b) => (Date.parse(String(b.updatedAt)) || 0) - (Date.parse(String(a.updatedAt)) || 0))
      .map((r) => r.data)
    const topics = profile.rows.filter((r) => r.data.status === 'known').map((r) => r.data.topicKey)
    return buildHintIndex(checked, topics)
  }, [concepts.rows, profile.rows])
  const hintFor = useCallback<ReaderKnowledgeApi['hintFor']>((c) => conceptHint(index, c), [index])

  if (isDemo) return { ready: true, isDemo, statusOf: demo.statusOf, isPending: () => false, set: demo.set, clear: demo.clear, hintFor: noHint }
  return { ready: concepts.ready, isDemo, statusOf: concepts.statusOf, isPending: concepts.isPending, set: concepts.set, clear: concepts.clear, hintFor }
}
