/**
 * Captures each screen for visual review. Signed-in screens use the
 * "Schema ada" test account and whatever data it has on the target app.
 */
import { test } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const DIR = process.env.SHOTS_DIR ?? 'test-results/shots'
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
]

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1000) // let one-time entrances finish
}

/*
 * Playwright emulates "no-preference" for every context unless told
 * otherwise, which hides Chrome's --force-prefers-reduced-motion flag, so the
 * reduced project also sets the media feature on each context and page.
 */
const motionFor = (project: string) => (project === 'reduced' ? 'reduce' : 'no-preference') as 'reduce' | 'no-preference'

async function shot(page: Page, name: string, project: string, w: number, fullPage = true) {
  await settle(page)
  await page.screenshot({ path: `${DIR}/${project}-${w}-${name}.png`, fullPage })
}

test('signed out', async ({ browser }, info) => {
  for (const { w, h } of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motionFor(info.project.name) })
    const page = await ctx.newPage()
    await page.goto('/')
    await shot(page, '01-landing', info.project.name, w)
    await page.getByTestId('landing-branch').nth(1).click({ force: true })
    await shot(page, '02-landing-panel', info.project.name, w, false)
    await page.keyboard.press('Escape')
    await page.goto('/p/1706~03762')
    await page.getByTestId('branch').first().waitFor({ timeout: 30_000 })
    await shot(page, '03-demo-paper', info.project.name, w)
    await page.getByTestId('next-up').click()
    await page.getByTestId('branch-panel').waitFor()
    await page.locator('[data-testid="concept-card"][data-next-up="true"] [data-testid="status-known"]').click()
    await shot(page, '04-demo-panel-marked', info.project.name, w, false)
    await ctx.close()
  }
})

test('signed in', async ({ users }, info) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.emulateMedia({ reducedMotion: motionFor(info.project.name) })
  let wsHref = ''
  for (const { w, h } of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/home')
    await shot(page, '05-home', info.project.name, w)
    // From md up the Add button is the sidebar's; on a phone it is in Home's header.
    await page.getByTestId(w < 768 ? 'home-add-open' : 'add-open').click()
    await page.getByTestId('add-choice-paper').click()
    await page.getByTestId('add-paper-input').fill('1706.03762')
    await page.getByTestId('add-paper-lookup').click()
    await page.getByTestId('add-paper-preview').waitFor({ timeout: 20_000 })
    await shot(page, '06-add-dialog', info.project.name, w, false)
    await page.keyboard.press('Escape')
    if (!wsHref) {
      await page.setViewportSize({ width: 1440, height: 900 })
      wsHref = (await page.getByTestId('sidebar-workspaces').locator('a').first().getAttribute('href')) ?? ''
      await page.setViewportSize({ width: w, height: h })
    }
    if (wsHref) {
      await page.goto(wsHref)
      await page.getByTestId('workspace-page').waitFor()
      await shot(page, '07-workspace', info.project.name, w)
    }
    await page.goto('/p/1706~03762')
    await page.getByTestId('branch').first().waitFor({ timeout: 30_000 })
    await shot(page, '08-paper', info.project.name, w)
    await page.getByTestId('next-up').click()
    await page.getByTestId('branch-panel').waitFor()
    await shot(page, '09-branch-panel', info.project.name, w, false)
    await page.keyboard.press('Escape')
    await page.getByTestId('view-walkthrough').click()
    await shot(page, '10-walkthrough', info.project.name, w)
    await page.getByTestId('view-branches').click()
    await page.goto('/knowledge')
    await page.getByTestId('knowledge-page').waitFor()
    await shot(page, '11-knowledge', info.project.name, w)
    await page.goto('/library')
    await page.getByTestId('library-page').waitFor()
    await shot(page, '12-library', info.project.name, w)
    if (w < 768) {
      await page.getByRole('button', { name: 'Open menu' }).click()
      await shot(page, '13-menu-sheet', info.project.name, w, false)
    }
  }
})

/*
 * The overview window, the step strip and concept cards, on one paper
 * (SHOTS_PAPER, default the demo paper). Each width starts from a cleared
 * browser state so the overview opens on its own. Strips are also captured
 * as zoomed element shots at 1440, 1280 and 390. Signed out it uses demo
 * mode; the signed-in variant uses "Schema ada" and marks the overview unread
 * first.
 */
const PAPER = process.env.SHOTS_PAPER ?? '1706~03762'
const OVERVIEW_WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 390, h: 844 },
]
const panelBody = '[data-testid="overview-window"] .overflow-y-auto'

async function overviewShots(page: Page, prefix: string, w: number, signedIn: boolean) {
  await page.goto(`/p/${PAPER}`)
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('schema:overview-')) localStorage.removeItem(k)
  })
  const paperPage = page.getByTestId('paper-page')
  if (signedIn) {
    await page.reload()
    await paperPage.and(page.locator('[data-overview-settled="true"]')).waitFor({ timeout: 30_000 })
    if ((await paperPage.getAttribute('data-overview')) === 'read') {
      if (!(await page.getByTestId('overview-window').isVisible())) await page.getByTestId('sequence-overview').click()
      await page.getByTestId('overview-read').click()
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('schema:overview-')) localStorage.removeItem(k)
      })
    }
  }
  await page.reload()
  const win = page.getByTestId('overview-window')
  await win.waitFor({ timeout: 30_000 })
  await page.mouse.move(2, 2)
  await shot(page, '20-overview', prefix, w, false)
  await page.locator(panelBody).evaluate((el) => (el.scrollTop = el.scrollHeight / 3))
  // The fourth sentence on the demo paper has formulas in its technical line; shorter stories use their last.
  const step = page.getByTestId('overview-step').nth(Math.min(3, (await page.getByTestId('overview-step').count()) - 1))
  await step.hover()
  await shot(page, '21-overview-hover-step', prefix, w, false)
  await step.getByTestId('overview-technical-toggle').click()
  await page.locator('[data-testid="overview-map"] [data-testid="overview-chip"]').first().hover()
  await shot(page, '22-overview-technical-hover-chip', prefix, w, false)
  await page.locator(panelBody).evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.mouse.move(2, 2)
  await shot(page, '23-overview-bottom', prefix, w, false)
  await page.keyboard.press('Escape')
  await win.waitFor({ state: 'detached' })
  await shot(page, '24-paper-unread', prefix, w, false)
  await page.getByTestId('sequence-strip').screenshot({ path: `${DIR}/${prefix}-${w}-25-strip-unread.png` })
  await page.getByTestId('next-up').click()
  await win.waitFor()
  await page.getByTestId('overview-read').click()
  await page.keyboard.press('Escape')
  await win.waitFor({ state: 'detached' })
  await page.getByTestId('sequence-strip').screenshot({ path: `${DIR}/${prefix}-${w}-26-strip-read.png` })
  if (await page.getByTestId('next-up').isVisible()) {
    await page.getByTestId('next-up').click()
    await page.getByTestId('branch-panel').waitFor()
    await shot(page, '27-cards', prefix, w, false)
    const key = await page.locator('[data-testid="concept-card"][data-next-up="true"]').getAttribute('data-concept-key')
    const next = page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)
    await next.getByTestId('status-known').click()
    await page.mouse.move(2, 2)
    await shot(page, '28-cards-marked', prefix, w, false)
    await next.getByTestId('status-known').click()
    await page.keyboard.press('Escape')
  }
}

test('overview, strip and cards, signed out', async ({ browser }, info) => {
  for (const { w, h } of OVERVIEW_WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: motionFor(info.project.name) })
    await overviewShots(await ctx.newPage(), `${info.project.name}-out`, w, false)
    await ctx.close()
  }
})

test('overview, strip and cards, signed in', async ({ users }, info) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.emulateMedia({ reducedMotion: motionFor(info.project.name) })
  for (const { w, h } of OVERVIEW_WIDTHS) {
    await ada.page.setViewportSize({ width: w, height: h })
    await overviewShots(ada.page, `${info.project.name}-in`, w, true)
  }
})
