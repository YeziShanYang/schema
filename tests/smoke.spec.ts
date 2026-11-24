import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/home'  → a dynamic page (under src/pages/(app)/): the providers mount,
 *                the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    // <Seo> (src/pages/index.tsx, values from src/seo.ts) hoists these into
    // <head>. Exactly one of each: index.html ships no static description or
    // canonical, because React 19 would not dedupe against them on mount.
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: landing fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    // Only the DO room route counts — vite's own HMR socket is a dev artifact.
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('landing hero draws its tags and phrases from the bundled snapshot', async ({ page }) => {
    const snap = JSON.parse(readFileSync(new URL('../src/data/demo-snapshot.json', import.meta.url), 'utf8')) as {
      paper: { abstract: string; firstPage: { introduction: string; figureCaption: string } | null }
      branches: { key: string; concepts: { key: string; name: string; quote: string; quoteDisplay?: string }[] }[]
    }
    const concepts = new Map(snap.branches.flatMap((b) => b.concepts).map((c) => [c.key, c]))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.getByTestId('hero-art')).toBeVisible()
    // The sheet's body is the paper's real first page from the snapshot.
    await expect(page.getByTestId('hero-art')).toContainText(snap.paper.abstract.slice(0, 60))
    await expect(page.getByTestId('hero-art')).toContainText(snap.paper.firstPage!.introduction.slice(0, 60))
    await expect(page.getByTestId('hero-art')).toContainText(snap.paper.firstPage!.figureCaption)

    const tags = page.getByTestId('hero-tag')
    const count = await tags.count()
    expect(count).toBeGreaterThanOrEqual(4)
    expect(count).toBeLessThanOrEqual(5)
    for (let i = 0; i < count; i++) {
      const key = (await tags.nth(i).getAttribute('data-concept-key')) ?? ''
      expect(concepts.has(key), `tag ${key} is a snapshot concept`).toBe(true)
      await expect(tags.nth(i)).toHaveText(concepts.get(key)!.name)
    }

    // Each highlighted phrase is copied from its concept's quote (or the LaTeX quoteDisplay).
    const phrases = page.getByTestId('hero-phrase')
    await expect(phrases).toHaveCount(count)
    for (let i = 0; i < count; i++) {
      const key = (await phrases.nth(i).getAttribute('data-concept-key')) ?? ''
      const phrase = (await phrases.nth(i).getAttribute('data-phrase')) ?? ''
      const c = concepts.get(key)!
      expect(phrase.length).toBeGreaterThan(0)
      expect((c.quoteDisplay || c.quote).includes(phrase), `"${phrase}" is in the quote of ${key}`).toBe(true)
    }
    // A phrase taken from a quoteDisplay renders its math with KaTeX.
    await expect(page.locator('[data-testid="hero-phrase"] .katex').first()).toBeAttached({ timeout: 10_000 })

    // The branch panel shows quoteDisplay through MathText too.
    const withMath = snap.branches.find((b) => b.concepts.some((c) => c.quote && c.quoteDisplay))!
    await page.locator(`[data-testid="landing-branch"][data-branch-key="${withMath.key}"]`).click()
    await expect(page.locator('[data-testid="landing-branch-concepts"] blockquote .katex').first()).toBeAttached({ timeout: 10_000 })
  })

  test('dynamic app boundary mounts on /home', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('sign-in button visible when logged out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})
