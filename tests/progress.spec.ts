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

function stage(page: Page, key: string) {
  return page.locator(`[data-testid="progress-stage"][data-stage-key="${key}"]`)
}

/**
 * Records, from the page itself, every distinct count of branch nodes and
 * every phase of the view, and whether the paper window was already
 * rendered while the finished view held.
 */
async function startRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __progress: { counts: number[]; phases: string[]; graphUnderHold: boolean } }
    w.__progress = { counts: [], phases: [], graphUnderHold: false }
    const look = () => {
      const rec = w.__progress
      const n = document.querySelectorAll('[data-testid="progress-branch"]').length
      if (n && rec.counts[rec.counts.length - 1] !== n) rec.counts.push(n)
      const phase = document.querySelector('[data-testid="analysis-progress"]')?.getAttribute('data-phase')
      if (phase && rec.phases[rec.phases.length - 1] !== phase) rec.phases.push(phase)
      if (phase === 'hold' && document.querySelector('[data-testid="paper-graph"]')) rec.graphUnderHold = true
    }
    look()
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] })
  })
}

async function recorded(page: Page) {
  return page.evaluate(() => (window as unknown as { __progress: { counts: number[]; phases: string[]; graphUnderHold: boolean } }).__progress)
}

/** The animation an element's graph entrance runs: schema-enter moves, schema-fade only fades. */
function entranceOf(page: Page, testId: string) {
  return page.getByTestId(testId).first().evaluate((el) => getComputedStyle(el.closest('.enter')!).animationName)
}

test('progress view: stage checklist, branches one at a time, elapsed time, then the paper window', async ({ users }) => {
  test.setTimeout(150_000)
  const [first, second] = await users(['Schema cara', 'Schema ada'])
  await first.page.goto('/home')
  await second.page.goto('/home')
  const left = [await allowance(first.page), await allowance(second.page)]
  const [requester, viewer] = left[0] >= left[1] ? [first, second] : [second, first]
  test.skip(Math.max(...left) === 0, 'Cara and Ada are at the daily cap in this local state')

  const page = requester.page
  const calm = viewer.page
  await calm.emulateMedia({ reducedMotion: 'reduce' })

  const id = await unusedId(page, '55')
  const slug = id.replace('.', '~')
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${slug}$`), { timeout: 15_000 })
  await expect(page.getByTestId('analysis-progress')).toBeVisible()
  await startRecorder(page)
  await calm.goto(`/p/${slug}`)
  await expect(calm.getByTestId('analysis-progress')).toBeVisible()

  // Reading the PDF: the first stage is active, the rest wait, and a scan line runs down the sheet.
  await expect(stage(page, 'text')).toHaveAttribute('data-state', 'active')
  for (const key of ['concepts', 'overview', 'explain']) await expect(stage(page, key)).toHaveAttribute('data-state', 'waiting')
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-scan', 'loop')
  expect(await page.locator('.sheet-scan').evaluate((el) => getComputedStyle(el).animationName)).toBe('sheet-scan')
  // Under reduced motion the sheet is static: no scan line at all.
  await expect(stage(calm, 'text')).toHaveAttribute('data-state', 'active')
  expect(await calm.locator('.sheet-scan').evaluate((el) => getComputedStyle(el).display)).toBe('none')
  await expect(page.getByTestId('progress-elapsed')).toContainText(/Elapsed \d+s/)

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
  await expect(foundations).toContainText('1 concept so far')
  await expect(page.locator('[data-testid="progress-branch"][data-branch-key="other"]')).toContainText('Other concepts')
  expect(await entranceOf(page, 'progress-branch')).toBe('schema-enter')
  await expect(calm.getByTestId('progress-branch')).toHaveCount(4)
  expect(await entranceOf(calm, 'progress-branch')).toBe('schema-fade')

  // Writing the walkthrough, then ready: the view holds, fades, and the paper window is there.
  await expect(stage(page, 'explain')).toHaveAttribute('data-state', 'active', { timeout: 30_000 })
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
  expect(rec.graphUnderHold).toBe(true)
})

test('a failed analysis shows the stage it stopped in, the retry note, the error and Retry', async ({ users }) => {
  test.setTimeout(90_000)
  const [cara] = await users(['Schema cara'])
  const page = cara.page
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/home')
  test.skip((await allowance(page)) === 0, 'Cara is at the daily cap in this local state')

  const id = await unusedId(page, '77')
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(/\/p\/0000~/, { timeout: 15_000 })
  // The first conversion error is retried once, and the job says so under the stage.
  await expect(page.getByTestId('progress-note')).toContainText('Retrying after an error: Fixture conversion failure', { timeout: 20_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: 30_000 })

  await expect(stage(page, 'text')).toHaveAttribute('data-state', 'failed')
  for (const key of ['concepts', 'overview', 'explain']) await expect(stage(page, key)).toHaveAttribute('data-state', 'waiting')
  const failed = page.getByTestId('paper-failed')
  await expect(failed).toContainText('Analysis failed: Fixture conversion failure')
  await expect(failed).toContainText('Anyone signed in can retry')
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeEnabled()
  await expect(page.getByTestId('progress-elapsed')).toContainText(/Stopped after \d+s/)
  await expect(page.getByTestId('paper-sheet')).toHaveAttribute('data-scan', 'none')
})
