/**
 * Writes the overview (with each concept's plain role and, where a quote has
 * math, its LaTeX display) for papers analyzed before the overview stage, on
 * the deployed app. One Haiku call per paper without one; papers that have
 * an overview are skipped for free. Then re-export the demo snapshot:
 *
 *   PAPERS=1706.03762,2611.29224,2611.29002 npx playwright test -c tests/live/playwright.live.config.ts overview-backfill
 *   node scripts/export-demo-snapshot.mjs 1706.03762
 */
import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const PAPERS = (process.env.PAPERS ?? '1706.03762,2611.29224,2611.29002').split(',').map((s) => s.trim()).filter(Boolean)

async function call(page: Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then((r) => r.json())
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

test('backfill overviews', async ({ users }) => {
  test.setTimeout(10 * 60_000)
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home')
  for (const arxivId of PAPERS) {
    const peek = await call(ada.page, 'peekPaper', { input: arxivId })
    expect(peek.success, `${arxivId}: ${peek.error}`).toBe(true)
    expect(peek.data.paperId, `${arxivId} is not analyzed`).not.toBe('')
    let r = await call(ada.page, 'ensureOverview', { paperId: peek.data.paperId })
    for (let i = 0; r.success && r.data.pending && i < 12; i++) {
      await ada.page.waitForTimeout(10_000)
      r = await call(ada.page, 'ensureOverview', { paperId: peek.data.paperId })
    }
    expect(r.success, `${arxivId}: ${r.error}`).toBe(true)
    const o = r.data.overview
    console.log(`[overview] ${arxivId}: ${r.data.cached ? 'cached' : 'written'}, ${o.story.length} story items, ${o.alsoNeeded.length} also needed`)
  }
})
