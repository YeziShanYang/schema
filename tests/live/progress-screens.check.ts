/**
 * Captures the analysis progress view stage by stage for visual review: one
 * slow fixture paper (ids ending in 55) watched from four windows, 1440 and
 * 390 wide, in a normal browser and one launched with
 * --force-prefers-reduced-motion, then a failed one (ids ending in 77).
 */
import { test, chromiumLaunchOptions, type MultiplayerUser } from 'deepspace/testing'
import { chromium, type Page } from '@playwright/test'

const DIR = process.env.SHOTS_DIR ?? 'test-results/progress-shots'
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
]

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

async function unusedId(page: Page, suffix: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const id = `0000.${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}${suffix}`
    const peek = await call(page, 'peekPaper', { input: id })
    if (peek.success && peek.data.status === 'new') return id
  }
  throw new Error('no unused id')
}

test('progress view screens', async ({ users, browser }, info) => {
  test.setTimeout(4 * 60_000)
  // The slow paper uses a daily slot: take it from whoever has one, Bob first,
  // since the e2e specs need Ada's and Cara's.
  let requester: MultiplayerUser | null = null
  for (const name of ['Schema bob', 'Schema dana', 'Schema cara', 'Schema ada']) {
    const [u] = await users([name])
    await u.page.goto('/home')
    const a = await call(u.page, 'myAllowance', {})
    if (a.success && a.data.analyze.remaining > 0) {
      requester = u
      break
    }
  }
  if (!requester) throw new Error('Every test account is at the daily cap in this local state')
  const storageState = await requester.context.storageState()
  const base = chromiumLaunchOptions()
  const reducedBrowser = await chromium.launch({ ...base, args: ['--force-prefers-reduced-motion'] })
  const baseURL = info.project.use.baseURL
  const views: { name: string; page: Page; w: number }[] = []
  for (const [mode, b] of [['motion', browser], ['reduced', reducedBrowser]] as const) {
    for (const { w, h } of WIDTHS) {
      // reducedMotion: null keeps the browser's own setting; Playwright's default would override the flag.
      const ctx = await b.newContext({ viewport: { width: w, height: h }, storageState, baseURL, reducedMotion: null })
      views.push({ name: `${mode}-${w}`, page: await ctx.newPage(), w })
    }
  }
  // A close-up of the sheet and checklist at 3x, for the details a 1x shot loses.
  const zoomCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3, storageState, baseURL })
  const zoom = await zoomCtx.newPage()
  const snap = (label: string, only?: string, zoomed = !only) =>
    Promise.all([
      ...views
        .filter((v) => !only || v.name === only)
        .map((v) => v.page.screenshot({ path: `${DIR}/${v.name}-${label}.png`, fullPage: v.w < 600 })),
      zoomed ? zoom.getByTestId('paper-progress').screenshot({ path: `${DIR}/zoom-${label}.png`, timeout: 5000 }).catch(() => null) : null,
    ])
  const lead = views[0].page
  const stageState = (key: string) => lead.locator(`[data-testid="progress-stage"][data-stage-key="${key}"]`)

  await requester.page.goto('/home')
  const id = await unusedId(requester.page, '55')
  const started = await call(requester.page, 'analyzePaper', { input: id })
  if (!started.success) throw new Error(started.error)
  for (const v of views) await v.page.goto(`/p/${id.replace('.', '~')}`)
  await zoom.goto(`/p/${id.replace('.', '~')}`)

  await stageState('text').and(lead.locator('[data-state="active"]')).waitFor({ timeout: 20_000 })
  await lead.waitForTimeout(1300)
  await snap('1-text')
  await stageState('concepts').and(lead.locator('[data-state="active"]')).waitFor({ timeout: 30_000 })
  await lead.waitForTimeout(2200)
  await snap('2-concepts')
  await stageState('overview').and(lead.locator('[data-state="active"]')).waitFor({ timeout: 30_000 })
  await lead.locator('[data-testid="progress-branch"]').nth(3).waitFor({ timeout: 20_000 })
  await lead.waitForTimeout(1500)
  await snap('3-overview')
  await stageState('explain').and(lead.locator('[data-state="active"]')).waitFor({ timeout: 30_000 })
  await lead.waitForTimeout(1500)
  await snap('4-explain')
  await lead.locator('[data-testid="analysis-progress"][data-phase="hold"]').waitFor({ timeout: 30_000 })
  await snap('5-done', 'motion-1440')
  await lead.locator('[data-testid="analysis-progress"]').waitFor({ state: 'detached', timeout: 10_000 })
  await lead.waitForTimeout(1200)
  await snap('6-ready', undefined, false)

  const failing = await unusedId(requester.page, '77')
  const r = await call(requester.page, 'analyzePaper', { input: failing })
  if (!r.success) throw new Error(r.error)
  for (const v of views) await v.page.goto(`/p/${failing.replace('.', '~')}`)
  await zoom.goto(`/p/${failing.replace('.', '~')}`)
  await lead.getByTestId('paper-failed').waitFor({ timeout: 30_000 })
  await Promise.all(views.map((v) => v.page.getByTestId('paper-failed').waitFor({ timeout: 10_000 })))
  await lead.waitForTimeout(800)
  await snap('7-failed')
  await reducedBrowser.close()
})
