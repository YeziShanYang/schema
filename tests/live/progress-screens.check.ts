/**
 * Captures the analysis progress view stage by stage for visual review: one
 * slow fixture paper (ids ending in 55) watched from four windows, 1440 and
 * 390 wide, in a normal browser and one launched with
 * --force-prefers-reduced-motion, then a failed one (ids ending in 77).
 */
import { test, chromiumLaunchOptions } from 'deepspace/testing'
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
  const [ada] = await users(['Schema ada'])
  const storageState = await ada.context.storageState()
  const base = chromiumLaunchOptions()
  const reducedBrowser = await chromium.launch({ ...base, args: [...(base.args ?? []), '--force-prefers-reduced-motion'] })
  const baseURL = info.project.use.baseURL
  const views: { name: string; page: Page; w: number }[] = []
  for (const [mode, b] of [['motion', browser], ['reduced', reducedBrowser]] as const) {
    for (const { w, h } of WIDTHS) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, storageState, baseURL })
      views.push({ name: `${mode}-${w}`, page: await ctx.newPage(), w })
    }
  }
  const snap = (label: string, only?: string) =>
    Promise.all(
      views
        .filter((v) => !only || v.name === only)
        .map((v) => v.page.screenshot({ path: `${DIR}/${v.name}-${label}.png`, fullPage: v.w < 600 })),
    )
  const lead = views[0].page
  const stageState = (key: string) => lead.locator(`[data-testid="progress-stage"][data-stage-key="${key}"]`)

  await ada.page.goto('/home')
  const id = await unusedId(ada.page, '55')
  const started = await call(ada.page, 'analyzePaper', { input: id })
  if (!started.success) throw new Error(started.error)
  for (const v of views) await v.page.goto(`/p/${id.replace('.', '~')}`)

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
  await snap('6-ready')

  const failing = await unusedId(ada.page, '77')
  const r = await call(ada.page, 'analyzePaper', { input: failing })
  if (!r.success) throw new Error(r.error)
  for (const v of views) await v.page.goto(`/p/${failing.replace('.', '~')}`)
  await lead.getByTestId('paper-failed').waitFor({ timeout: 30_000 })
  await Promise.all(views.map((v) => v.page.getByTestId('paper-failed').waitFor({ timeout: 10_000 })))
  await lead.waitForTimeout(800)
  await snap('7-failed')
  await reducedBrowser.close()
})
