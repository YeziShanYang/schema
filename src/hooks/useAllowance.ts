/**
 * The signed-in reader's remaining daily allowances, from the `myAllowance`
 * action (usage events are server-only). Refreshes after any metered action
 * and when the window regains focus.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from 'deepspace'
import { actions, USAGE_EVENT, type Allowances } from '../lib/actions-client'

export function useAllowance() {
  const { isSignedIn } = useAuth()
  const [data, setData] = useState<Allowances | null>(null)

  const refresh = useCallback(async () => {
    if (!isSignedIn) return setData(null)
    const r = await actions.myAllowance()
    if (r.success) setData(r.data)
  }, [isSignedIn])

  useEffect(() => {
    void refresh()
    const onUsage = () => void refresh()
    window.addEventListener(USAGE_EVENT, onUsage)
    window.addEventListener('focus', onUsage)
    return () => {
      window.removeEventListener(USAGE_EVENT, onUsage)
      window.removeEventListener('focus', onUsage)
    }
  }, [refresh])

  return { allowance: data, refresh }
}
