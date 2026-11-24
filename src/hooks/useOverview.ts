/**
 * The paper overview for the paper window. It generates the overview once
 * for papers analyzed before overviews existed (ensureOverview, signed in),
 * and tracks whether this reader has read it: RoadmapData.overviewReadAt when
 * signed in, localStorage in signed-out demo mode. `autoOpen` is true the
 * first time this browser shows the paper while the overview is unread.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordData } from 'deepspace'
import type { PaperData, PaperOverview } from '../types'
import { actions } from '../lib/actions-client'
import { useRoadmaps } from './useReader'

function readPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function writePref(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // storage unavailable; the choice just isn't remembered
  }
}

/** localStorage keys, by arXiv id so they read the same before and after the paper record loads. */
export const overviewShownKey = (arxivId: string) => `schema:overview-shown:${arxivId}`
const demoReadKey = (arxivId: string) => `schema:overview-read:${arxivId}`

export interface OverviewState {
  overview: PaperOverview | null
  /** Being generated right now (by this reader or another). */
  generating: boolean
  error: string
  /** False until the read state is loaded (the reader's roadmaps, or localStorage in demo mode). */
  known: boolean
  read: boolean
  setRead: (read: boolean) => Promise<void>
  /** Open it on its own: the first time this browser shows the paper, while it is unread. */
  autoOpen: boolean
  /** Call once it has opened on its own, so it does not open on its own again. */
  markAutoOpened: () => void
}

export function useOverview(paper: RecordData<PaperData> | null, opts: { signedIn: boolean; isDemo: boolean }): OverviewState {
  const roadmaps = useRoadmaps()
  const paperId = paper?.recordId ?? ''
  const arxivId = paper?.data.arxivId ?? ''
  const overview = paper?.data.overview ?? null
  const ready = paper?.data.status === 'ready'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Older papers: ask the server to write the overview once.
  const asked = useRef('')
  useEffect(() => {
    if (!paperId || overview || !ready || !opts.signedIn || asked.current === paperId) return
    asked.current = paperId
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      setBusy(true)
      setError('')
      const r = await actions.ensureOverview(paperId)
      if (!alive) return
      if (!r.success) {
        setBusy(false)
        setError(r.error)
      } else if (r.data.pending) {
        // Someone else is writing it; it arrives on the paper record. Ask again later in case that run died.
        timer = setTimeout(run, 20_000)
      } else {
        setBusy(false)
      }
    }
    void run()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [paperId, overview, ready, opts.signedIn])
  useEffect(() => {
    if (overview) setBusy(false)
  }, [overview])

  // Demo mode keeps the read mark in this browser. Storage is read during
  // render so the auto-open decision never sees a value from before it loaded.
  const [demoMarks, setDemoMarks] = useState<Record<string, boolean>>({})
  const demoRead = arxivId ? demoMarks[arxivId] ?? readPref(demoReadKey(arxivId)) === '1' : false

  const roadmap = paperId ? roadmaps.byPaper.get(paperId) : undefined
  const savedRead = !!roadmap?.data.overviewReadAt
  // The reader's click shows at once, until the roadmap row agrees.
  const [localRead, setLocalRead] = useState<boolean | null>(null)
  useEffect(() => {
    if (localRead !== null && savedRead === localRead) setLocalRead(null)
  }, [savedRead, localRead])

  const known = !!arxivId && (opts.isDemo || roadmaps.ready)
  const read = opts.isDemo ? demoRead : localRead ?? savedRead

  const { setOverviewRead } = roadmaps
  const setRead = useCallback(
    async (next: boolean) => {
      if (!paper) return
      if (opts.isDemo) {
        writePref(demoReadKey(paper.data.arxivId), next ? '1' : '')
        setDemoMarks((m) => ({ ...m, [paper.data.arxivId]: next }))
        return
      }
      setLocalRead(next)
      try {
        await setOverviewRead({ paperId: paper.recordId, arxivId: paper.data.arxivId, title: paper.data.title }, next)
      } catch (e) {
        console.warn(`[overview] saving the read mark failed: ${e instanceof Error ? e.message : String(e)}`)
        setLocalRead(null)
      }
    },
    [paper, opts.isDemo, setOverviewRead],
  )

  const [shownHere, setShownHere] = useState('')
  const shown = !arxivId || shownHere === arxivId || readPref(overviewShownKey(arxivId)) === '1'
  const autoOpen = !!overview && ready && known && !read && !shown
  const markAutoOpened = useCallback(() => {
    if (!arxivId) return
    writePref(overviewShownKey(arxivId), '1')
    setShownHere(arxivId)
  }, [arxivId])

  return {
    overview,
    generating: !overview && (busy || (!!paper?.data.overviewLoadingAt && Date.now() - paper.data.overviewLoadingAt < 2 * 60_000)),
    error,
    known,
    read,
    setRead,
    autoOpen,
    markAutoOpened,
  }
}
