/**
 * Retrying a failed analysis, shared by the paper window's progress view and
 * the library, so both go through retryPaper the same way. usePaperSlot reads
 * whether the reader's own request of a failed paper still uses a daily slot
 * (it failed after a paid step) or was given back (refundAnalyze ran).
 */

import { useCallback, useEffect, useState } from 'react'
import { actions, type PaperSlot } from '../lib/actions-client'
import type { PaperStatus } from '../types'

export function useRetryPaper(paperId: string | undefined) {
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const retry = useCallback(async () => {
    if (!paperId) return
    setRetrying(true)
    const r = await actions.retryPaper(paperId)
    setRetrying(false)
    setError(r.success ? '' : r.error)
  }, [paperId])
  return { retry, retrying, error }
}

/** Loaded while the paper shows failed and the reader is signed in; null until known. */
export function usePaperSlot(paperId: string | undefined, status: PaperStatus | undefined, signedIn: boolean): PaperSlot | null {
  const [slot, setSlot] = useState<PaperSlot | null>(null)
  useEffect(() => {
    setSlot(null)
    if (!paperId || status !== 'failed' || !signedIn) return
    let live = true
    void actions.myPaperSlot(paperId).then((r) => {
      if (live && r.success) setSlot(r.data.slot)
    })
    return () => {
      live = false
    }
  }, [paperId, status, signedIn])
  return slot
}
