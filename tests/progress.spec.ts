/**
 * The analysis progress view, watched live against the local runtime.
 *
 * Fixture ids ending in 55 answer every integration call after 4 seconds
 * (src/server/pipeline/fixtures.ts), so each stage stays on screen long
 * enough to check. Ids ending in 77 fail the PDF conversion, which refunds
 * the daily slot. One reader watches with normal motion, another opens the
 * same paper with reduced motion.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const usable = loadAllTestAccounts().length
test.skip(usable < 2, `Needs 2 test accounts, found ${usable}. Create them with \`npx deepspace test accounts create\`.`)
test.describe.configure({ mode: 'serial' })

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

/** A fixture id ending in `suffix` that nobody has analyzed yet. */
async function unusedId(page: Page, suffix: '55' | '77'): Promise<string> {
  for (let tries = 0; tries < 30; tries++) {
    const id = `0000.${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}${suffix}`
    const peek = await call(page, 'peekPaper', { input: id })
    if (peek.success && peek.data.status === 'new') return id
  }
  throw new Error('No unused fixture id found')
}

async function allowance(page: Page): Promise<number> {
  const r = await call(page, 'myAllowance', {})
  return r.success ? r.data.analyze.remaining : 0
}

/** Home's paper box sends a new paper through the Add window; it goes into a new fixture workspace. */
async function startFromHome(page: Page, id: string) {
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  const dialog = page.getByTestId('add-dialog')
  await expect(dialog.getByTestId('add-paper-preview')).toBeVisible({ timeout: 15_000 })
  await dialog.getByTestId('dest-new').check()
  await dialog.getByTestId('dest-name').fill(`[fixture] Progress ${Date.now()}`)
  await dialog.getByTestId('add-paper-submit').click()
}

function stage(page: Page, key: string) {
  return page.locator(`[data-testid="progress-stage"][data-stage-key="${key}"]`)
}

type Recorded = { counts: number[]; phases: string[]; graphUnderHold: boolean; graphDuringFade: boolean }

/**
 * Records, from the page itself, every distinct count of branch nodes and
 * every phase of the view, and whether the paper window was rendered
 * while the finished view held (it should not be) and while it faded.
 */
async function startRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __progress: Recorded }
    w.__progress = { counts: [], phases: [], graphUnderHold: false, graphDuringFade: false }
    const look = () => {
      const rec = w.__progress
      const n = document.querySelectorAll('[data-testid="progress-branch"]').length
      if (n && rec.counts[rec.counts.length - 1] !== n) rec.counts.push(n)
      const phase = document.querySelector('[data-testid="analysis-progress"]')?.getAttribute('data-phase')
      if (phase && rec.phases[rec.phases.length - 1] !== phase) rec.phases.push(phase)
      if (phase === 'hold' && document.querySelector('[data-testid="paper-graph"]')) rec.graphUnderHold = true
      if (phase === 'fade' && document.querySelector('[data-testid="paper-graph"]')) rec.graphDuringFade = true
    }
    look()
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] })
  })
}

async function recorded(page: Page) {
  return page.evaluate(() => (window as unknown as { __progress: Recorded }).__progress)
}

/** Delay and duration of each link's entrance in the progress graph, in node order. */
function linkTimings(page: Page) {
  return page.getByTestId('progress-graph').evaluate((g) =>
    [...g.querySelectorAll('.graph-links path')].map((el) => [getComputedStyle(el).animationDelay, getComputedStyle(el).animationDuration]),
  )
}

/** Delay and duration of each node's entrance in the progress graph. */
function nodeTimings(page: Page) {
  return page.getByTestId('progress-graph').evaluate((g) =>
    [...g.querySelectorAll('.graph-node > .enter')].map((el) => [getComputedStyle(el).animationDelay, getComputedStyle(el).animationDuration]),
  )
}

/** The animation an element's graph entrance runs: schema-enter moves, schema-fade only fades. */
function entranceOf(page: Page, testId: string) {
  return page.getByTestId(testId).first().evaluate((el) => getComputedStyle(el.closest('.enter')!).animationName)
}

test('progress view: stage checklist, branches one at a time, elapsed time, then the paper window', async ({ users }) => {
  test.setTimeout(150_000)
  // Bob requests when he can: the daily-cap spec uses up his papers anyway, which
  // leaves Cara and Ada room for the failure spec. Anyone watches with reduced motion.
  const people = await users(['Schema bob', 'Schema cara', 'Schema ada'])
  const left: number[] = []
  for (const p of people) {
    await p.page.goto('/home')
    left.push(await allowance(p.page))
  }
  const pick = left[0] > 0 ? 0 : left.indexOf(Math.max(...left))
  test.skip(left[pick] === 0, 'Bob, Cara and Ada are at the daily cap in this local state')
  const requester = people[pick]
  const viewer = people[pick === 0 ? 1 : 0]

  const page = requester.page
  const calm = viewer.page
  await calm.emulateMedia({ reducedMotion: 'reduce' })

  const id = await unusedId(page, '55')
  const slug = id.replace('.', '~')
  await startFromHome(page, id)
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`), { timeout: 15_000 })
  await expect(page.getByTestId('analysis-progress')).toBeVisible()
  await startRecorder(page)
  await calm.goto(`/p/${slug}`)
  await expect(calm.getByTestId('analysis-progress')).toBeVisible()

  // Reading the paper: the first stage is active, the rest wait, and a scan line runs down the sheet.
  await expect(stage(page, 'text')).toHaveAttribute('data-state', 'active')
  for (const key of ['concepts', 'overview', 'explain', 'verify']) await expect(stage(page, key)).toHaveAttribute('data-state', 'waiting')
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-scan', 'loop')
  expect(await page.locator('.sheet-scan').evaluate((el) => getComputedStyle(el).animationName)).toBe('sheet-scan')
  // Under reduced motion the sheet is static: no scan line at all.
  await expect(stage(calm, 'text')).toHaveAttribute('data-state', 'active')
  expect(await calm.locator('.sheet-scan').evaluate((el) => getComputedStyle(el).display)).toBe('none')
  await expect(page.getByTestId('progress-elapsed')).toContainText(/Elapsed \d+s/)
  await expect(page.getByTestId('paper-progress')).toContainText('Usually 1 to 2 minutes')

  // Finding concepts: reading is done and shows how long it took; highlights appear on the sheet.
  await expect(stage(page, 'concepts')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })
  await expect(stage(page, 'text')).toHaveAttribute('data-state', 'done')
  await expect(stage(page, 'text').getByTestId('progress-stage-time')).toHaveText(/^\d+s$/)
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-marks', 'loop')
  await expect(calm.getByTestId('paper-sheet')).toHaveAttribute('data-marks', 'loop')
  expect(await calm.locator('.sheet-bar[data-mark]').first().evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none')

  // Writing the overview: the concept records arrive and their branches join the graph.
  await expect(stage(page, 'overview')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })
  await expect(page.getByTestId('progress-branch')).toHaveCount(4, { timeout: 20_000 })
  const foundations = page.locator('[data-testid="progress-branch"][data-branch-key="foundations"]')
  await expect(foundations).toContainText('Foundations')
  await expect(foundations).toContainText('2 concepts so far')
  await expect(page.locator('[data-testid="progress-branch"][data-branch-key="other"]')).toContainText('Other concepts')
  expect(await entranceOf(page, 'progress-branch')).toBe('schema-enter')
  await expect(calm.getByTestId('progress-branch')).toHaveCount(4)
  expect(await entranceOf(calm, 'progress-branch')).toBe('schema-fade')
  // Each dashed link fades in with its node, never ahead of it.
  for (const p of [page, calm]) expect(await linkTimings(p)).toEqual(await nodeTimings(p))

  // Writing the walkthrough, then checking the overview, then ready: the view holds, fades, and the paper window is there.
  await expect(stage(page, 'explain')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })
  await expect(stage(page, 'verify')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })
  await expect(stage(page, 'explain')).toHaveAttribute('data-state', 'done')
  await expect(stage(page, 'verify')).toContainText('Checking the overview')
  // Checking the overview against the paper runs the scan line again.
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-scan', 'loop')
  const elapsed = Number(await page.getByTestId('progress-elapsed').getAttribute('data-ms'))
  await expect.poll(async () => Number(await page.getByTestId('progress-elapsed').getAttribute('data-ms'))).toBeGreaterThan(elapsed)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await expect(page.getByTestId('analysis-progress')).toHaveCount(0)
  await expect(page.getByTestId('branch')).toHaveCount(4)
  await expect(calm.getByTestId('analysis-progress')).toHaveCount(0)
  await expect(calm.getByTestId('branch')).toHaveCount(4)

  const rec = await recorded(page)
  // Nodes joined one at a time, never two in one render.
  expect(rec.counts).toEqual([1, 2, 3, 4])
  expect(rec.phases).toEqual(['on', 'hold', 'fade'])
  // The paper window mounts when the fade starts, so its entrance plays as the view fades out.
  expect(rec.graphUnderHold).toBe(false)
  expect(rec.graphDuringFade).toBe(true)
})

test('a failed analysis shows the stage it stopped in, the retry note, the error and Retry', async ({ users }) => {
  test.setTimeout(90_000)
  // The conversion fails before anything is billed, so the slot it reserves comes back.
  const people = await users(['Schema cara', 'Schema ada'])
  let page = people[0].page
  for (const p of people) {
    await p.page.goto('/home')
    if ((await allowance(p.page)) > 0) {
      page = p.page
      break
    }
  }
  test.skip((await allowance(page)) === 0, 'Cara and Ada are at the daily cap in this local state')
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const id = await unusedId(page, '77')
  await startFromHome(page, id)
  await expect(page).toHaveURL(/\/p\/0000~/, { timeout: 15_000 })
  // The first conversion error is retried once, and the job says so under the stage.
  await expect(page.getByTestId('progress-note')).toContainText('Retrying after an error: Fixture conversion failure', { timeout: 20_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: 30_000 })

  await expect(stage(page, 'text')).toHaveAttribute('data-state', 'failed')
  for (const key of ['concepts', 'overview', 'explain', 'verify']) await expect(stage(page, key)).toHaveAttribute('data-state', 'waiting')
  const failed = page.getByTestId('paper-failed')
  await expect(failed).toContainText('Analysis failed: Fixture conversion failure')
  await expect(failed).toContainText('Anyone signed in can retry')
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeEnabled()
  await expect(page.getByTestId('progress-elapsed')).toContainText(/Stopped after \d+s/)
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-scan', 'none')
})
