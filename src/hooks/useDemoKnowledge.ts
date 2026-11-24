/**
 * Signed-out demo mode: an in-memory stand-in with the same shape as
 * useKnowledge. Nothing is written to the backend and nothing is persisted;
 * reloading the page starts over.
 */

import { useCallback, useMemo, useState } from 'react'
import { useAuth } from 'deepspace'
import type { RecordData } from 'deepspace'
import type { KnowledgeData } from '../types'
import { useKnowledge, type KnowledgeApi } from './useReader'

export function useDemoKnowledge(): KnowledgeApi {
  const [map, setMap] = useState<Map<string, KnowledgeData>>(() => new Map())

  const rows = useMemo<RecordData<KnowledgeData>[]>(
    () =>
      [...map.entries()].map(([topicKey, data]) => ({
        recordId: `demo-${topicKey}`,
        data,
        createdBy: 'demo',
        createdAt: '',
        updatedAt: '',
      })) as unknown as RecordData<KnowledgeData>[],
    [map],
  )
  const byTopic = useMemo(() => new Map(rows.map((r) => [r.data.topicKey, r])), [rows])

  const set = useCallback<KnowledgeApi['set']>(async (topicKey, status, source, from) => {
    setMap((prev) => {
      const next = new Map(prev)
      next.set(topicKey, { userId: 'demo', topicKey, status, source, paperId: from?.paperId ?? '', arxivId: from?.arxivId ?? '' })
      return next
    })
  }, [])

  const clear = useCallback(async (topicKey: string) => {
    setMap((prev) => {
      const next = new Map(prev)
      next.delete(topicKey)
      return next
    })
  }, [])

  const statusOf = useCallback((topicKey: string) => (map.get(topicKey)?.status === 'known' ? 'known' : null), [map])

  return { ready: true, status: 'ready', rows, byTopic, statusOf, isPending: () => false, set, clear }
}

/**
 * The knowledge API for the current visitor: the real profile when signed in,
 * the in-memory demo adapter when signed out. Both hooks always run so the
 * hook order never changes.
 */
export function useReaderKnowledge(): KnowledgeApi & { isDemo: boolean } {
  const { isSignedIn, isLoaded } = useAuth()
  const real = useKnowledge()
  const demo = useDemoKnowledge()
  const isDemo = isLoaded && !isSignedIn
  return { ...(isDemo ? demo : real), isDemo }
}
