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

  test('landing gives the same analysis time as the app', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toContainText('A paper nobody has analyzed takes 1 to 2 minutes.')
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
    // Math in a phrase (copied from a quoteDisplay) or in the introduction renders with KaTeX.
    const phraseMath = await phrases.evaluateAll((els) => els.some((e) => (e.getAttribute('data-phrase') ?? '').includes('\\(')))
    if (phraseMath) await expect(page.locator('[data-testid="hero-phrase"] .katex').first()).toBeAttached({ timeout: 10_000 })
    if (snap.paper.firstPage!.introduction.includes('\\(')) await expect(page.getByTestId('hero-art').locator('p .katex').first()).toBeAttached({ timeout: 10_000 })

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

/** Whether dark mode is on, and how light the page background and the hero's paper sheet paint (0 to 255). */
async function paint(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    // A canvas turns any CSS color (oklch included) into sRGB.
    const ctx = document.createElement('canvas').getContext('2d')!
    const lightness = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return Math.round((r + g + b) / 3)
    }
    const sheet = document.querySelector('.hero-sheet')
    return {
      dark: document.documentElement.classList.contains('dark'),
      page: lightness(getComputedStyle(document.body).backgroundColor),
      sheet: sheet ? lightness(getComputedStyle(sheet).backgroundColor) : null,
    }
  })
}

test.describe('Theme', () => {
  test('follows the system setting until the reader picks, keeps the pick across a reload, and stays static', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    // The landing's static contract holds through the head script and the toggle.
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    const toggle = page.getByTestId('theme-toggle')
    await expect(toggle).toHaveAccessibleName('Switch to light theme')
    let p = await paint(page)
    expect(p.dark).toBe(true)
    expect(p.page).toBeLessThan(60)
    // The hero's paper stays paper-colored, dimmed.
    expect(p.sheet).toBeGreaterThan(200)
    expect(p.sheet).toBeLessThan(245)

    // Nothing is stored yet, so a change of system setting is followed.
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(async () => (await paint(page)).dark).toBe(false)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(async () => (await paint(page)).dark).toBe(true)

    // The reader picks light. Transitions are off for the swap and back on a frame later.
    expect(await toggle.evaluate((el: HTMLElement) => {
      el.click()
      return document.documentElement.classList.contains('no-transitions')
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('no-transitions'))).toBe(false)
    await expect(toggle).toHaveAccessibleName('Switch to dark theme')
    p = await paint(page)
    expect(p.dark).toBe(false)
    expect(p.page).toBeGreaterThan(230)
    expect(await page.evaluate(() => localStorage.getItem('schema:theme'))).toBe('light')

    // The pick survives a reload under a dark system setting, and a later system change.
    await page.reload()
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect((await paint(page)).dark).toBe(false)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(200)
    expect((await paint(page)).dark).toBe(false)

    await toggle.click()
    expect((await paint(page)).dark).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('schema:theme'))).toBe('dark')
    await page.waitForTimeout(1000)
    expect(offenders).toEqual([])
    await ctx.close()
  })

  test('the head script paints the stored theme before any app code or CSS loads', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' })
    await ctx.addInitScript(() => localStorage.setItem('schema:theme', 'dark'))
    const page = await ctx.newPage()
    // With the app bundle (and the stylesheet it imports) blocked, only index.html runs.
    await page.route(/\/src\/main\.tsx/, (route) => route.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const first = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      background: getComputedStyle(document.documentElement).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }))
    expect(first).toEqual({ dark: true, background: 'rgb(14, 19, 28)', scheme: 'dark' })
    await ctx.close()
  })

  test('the signed-out top bar has the toggle beside Sign in', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' })
    const page = await ctx.newPage()
    await page.goto('/home')
    const bar = page.getByTestId('app-navigation')
    await expect(bar.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await bar.getByTestId('theme-toggle').click()
    expect((await paint(page)).dark).toBe(true)
    await ctx.close()
  })
})
