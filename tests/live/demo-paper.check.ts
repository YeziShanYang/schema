/**
 * Builds the demo data on the deployed app with real calls: analyzes the
 * demo paper, loads explainer links for every branch, and generates a few
 * AI explanations so signed-out visitors see them. Re-runnable: anything
 * already cached costs nothing.
 *
 *   npx playwright test -c tests/live/playwright.live.config.ts demo-paper
 */
import { test, expect } from 'deepspace/testing'

const PAPER = '1706.03762'
const SLUG = '1706~03762'
const EXPLANATIONS = 4

test('demo paper: analyze, load every branch, pre-generate explanations', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.emulateMedia({ reducedMotion: 'reduce' }) // drifting nodes never settle for Playwright's click

  await page.goto(`/p/${SLUG}`)
  const paperPage = page.getByTestId('paper-page')
  const missing = page.getByTestId('paper-missing')
  // Wait until the page knows whether the paper exists, then start it if needed.
  await expect(paperPage.or(missing)).toBeVisible({ timeout: 30_000 })
  if (await missing.isVisible()) {
    await page.getByTestId('analyze-input').fill(PAPER)
    await page.getByTestId('analyze-submit').click()
  }
  const started = Date.now()
  await expect(paperPage).toHaveAttribute('data-paper-status', 'ready', { timeout: 8 * 60_000 })
  console.log(`[demo] ready after ${Math.round((Date.now() - started) / 1000)}s`)

  const branches = page.getByTestId('branch')
  const n = await branches.count()
  console.log(`[demo] branches: ${(await branches.allInnerTexts()).map((t) => t.split('\n')[0]).join(' | ')}`)
  for (let i = 0; i < n; i++) {
    await branches.nth(i).click()
    const links = page.getByTestId('branch-links')
    if ((await links.getAttribute('data-links')) === 'needs-load') {
      await page.getByTestId('load-links').click()
    }
    await expect(links).toHaveAttribute('data-links', 'ready', { timeout: 3 * 60_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('branch-panel')).toHaveCount(0)
  }

  // Explanations for the first deep concepts, falling back to any concept.
  let made = 0
  for (let i = 0; i < n && made < EXPLANATIONS; i++) {
    await branches.nth(i).click()
    const cards = page.getByTestId('branch-concepts').getByTestId('concept-card')
    const count = await cards.count()
    for (let j = 0; j < count && made < EXPLANATIONS; j++) {
      const c = cards.nth(j)
      if ((await c.getByTestId('explain-toggle').count()) > 0) {
        made++
        continue
      }
      const btn = c.getByTestId('explain-button')
      if ((await btn.count()) === 0) continue
      await btn.click()
      await expect(c.getByTestId('concept-explanation')).toBeVisible({ timeout: 90_000 })
      made++
    }
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('branch-panel')).toHaveCount(0)
  }
  console.log(`[demo] explanations present: ${made}`)
  expect(made).toBeGreaterThanOrEqual(3)
})
