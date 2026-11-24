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
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900) // let one-time entrances finish
}

async function shot(page: Page, name: string, project: string, w: number, fullPage = true) {
  await settle(page)
  await page.screenshot({ path: `${DIR}/${project}-${w}-${name}.png`, fullPage })
}

test('signed out', async ({ browser }, info) => {
  for (const { w, h } of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto('/')
    await shot(page, '01-landing', info.project.name, w)
    await page.goto('/home')
    await shot(page, '02-home-signed-out', info.project.name, w)
    await page.goto('/p/1706~03762')
    await page.getByTestId('branch').first().waitFor({ timeout: 30_000 })
    await shot(page, '03-demo-paper', info.project.name, w)
    await page.getByTestId('branch-concepts').getByTestId('status-known').first().click()
    await shot(page, '04-demo-paper-marked', info.project.name, w, false)
    await ctx.close()
  }
})

test('signed in', async ({ users }, info) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  let wsHref = ''
  for (const { w, h } of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/home')
    await shot(page, '05-home', info.project.name, w)
    if (!wsHref) {
      await page.setViewportSize({ width: 1440, height: 900 })
      wsHref = (await page.getByTestId('sidebar-workspaces').locator('a').first().getAttribute('href')) ?? ''
      await page.setViewportSize({ width: w, height: h })
    }
    if (wsHref) {
      await page.goto(wsHref)
      await page.getByTestId('workspace-page').waitFor()
      await shot(page, '06-workspace', info.project.name, w)
    }
    await page.goto('/p/1706~03762')
    await page.getByTestId('branch').first().waitFor({ timeout: 30_000 })
    await shot(page, '07-paper', info.project.name, w)
    await page.getByTestId('view-walkthrough').click()
    await shot(page, '08-walkthrough', info.project.name, w)
    await page.getByTestId('view-branches').click()
    await page.goto('/knowledge')
    await page.getByTestId('knowledge-page').waitFor()
    await shot(page, '09-knowledge', info.project.name, w)
    await page.goto('/library')
    await page.getByTestId('library-page').waitFor()
    await shot(page, '10-library', info.project.name, w)
    if (w < 768) {
      await page.getByRole('button', { name: 'Open menu' }).click()
      await shot(page, '11-menu-sheet', info.project.name, w, false)
    }
  }
})
