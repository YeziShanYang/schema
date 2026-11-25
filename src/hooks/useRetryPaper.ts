/**
 * Retrying a failed analysis, shared by the paper window's progress view and
 * the library, so both go through retryPaper the same way.
 */

import { useCallback, useState } from 'react'
import { actions } from '../lib/actions-client'

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
