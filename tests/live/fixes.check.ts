/**
 * Checks this phase's fixes on the deployed app. No paid calls: everything
 * it opens is already analyzed or cached.
 *
 *   npx playwright test -c tests/live/playwright.live.config.ts fixes
 */
import { test, expect } from 'deepspace/testing'
import type { Locator, Page } from '@playwright/test'

test('signed out: /home asks for sign-in, landing links open it, odd paper URLs resolve', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/home')
  await expect(page.getByTestId('signed-out-panel')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('home-page')).toHaveCount(0)

  await page.goto('/')
  await expect(page.locator('h1')).toContainText("learn the ones you're missing")
  await page.getByTestId('landing-start').click()
  await expect(page).toHaveURL(/\/home\?signin=1$/)
  await expect(page.getByTestId('auth-overlay')).toBeVisible({ timeout: 20_000 })

  // Dotted ids redirect to the slug; versioned ids open the canonical paper.
  const res = await page.request.get('/p/1706.03762', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers()['location']).toMatch(/\/p\/1706~03762$/)
  await page.goto('/p/1706~03762v1')
  await expect(page).toHaveURL(/\/p\/1706~03762$/, { timeout: 20_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await page.goto('/p/garbage')
  await expect(page.getByTestId('paper-invalid')).toBeVisible({ timeout: 20_000 })
})

async function eachBranch(page: Page, visit: (panel: Locator) => Promise<boolean>) {
  const branches = page.getByTestId('branch')
  for (let i = 0; i < (await branches.count()); i++) {
    await branches.nth(i).click()
    const panel = page.getByTestId('branch-panel')
    await expect(panel.getByTestId('concept-card').first()).toBeVisible()
    const done = await visit(panel)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('branch-panel')).toHaveCount(0)
    if (done) return true
  }
  return false
}

test('quotes with math render as LaTeX', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/p/2611~29224')
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  const found = await eachBranch(page, async (panel) => {
    const quotes = panel.locator('blockquote [data-math="true"]')
    if ((await quotes.count()) === 0) return false
    await expect(quotes.first().locator('.katex').first()).toBeVisible({ timeout: 20_000 })
    return true
  })
  expect(found, 'a quote rendered as LaTeX').toBe(true)
})

test('a check question locks after one answer and shows the correct choice', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/p/1706~03762')
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  const found = await eachBranch(page, async (panel) => {
    const withCheck = panel.getByTestId('concept-card').filter({ has: page.getByTestId('check-toggle') })
    if ((await withCheck.count()) === 0) return false
    const card = withCheck.first()
    await card.getByTestId('check-toggle').click()
    await card.getByTestId('check-choice').first().click()
    await expect(card.getByTestId('check-result')).toBeVisible()
    for (const choice of await card.getByTestId('check-choice').all()) await expect(choice).toBeDisabled()
    await expect(card.locator('[data-testid="check-choice"][data-correct="true"]')).toHaveCount(1)
    return true
  })
  expect(found, 'a concept with a check question').toBe(true)
})

test('signed in: one known checkbox per concept, green outline when known', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/p/1706~03762')
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await page.getByTestId('branch').first().click()
  const card = page.getByTestId('branch-panel').getByTestId('concept-card').first()
  await expect(card.getByTestId('status-learning')).toHaveCount(0)
  const box = card.getByTestId('status-known')
  await expect(box).toBeEnabled({ timeout: 20_000 })
  if ((await box.getAttribute('aria-checked')) === 'true') {
    await box.click()
    await expect(box).toHaveAttribute('aria-checked', 'false')
    await expect(box).toBeEnabled({ timeout: 20_000 })
  }
  await box.click()
  await expect(box).toHaveAttribute('aria-checked', 'true')
  await expect(card).toHaveClass(/known-outline/)
  await expect(box).toBeEnabled({ timeout: 20_000 })
  await box.click()
  await expect(box).toHaveAttribute('aria-checked', 'false')
  await expect(card).not.toHaveClass(/known-outline/)
})
