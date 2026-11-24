/**
 * Finish condition on the deployed app for a fresh account:
 * create a workspace through the Add window (starter recommendations run),
 * add the cached demo paper, follow Next up into the branch panel, mark the
 * concept known, reload, finish, read again. Only the starter recommendation
 * run costs credits.
 *
 *   npx playwright test -c tests/live/playwright.live.config.ts finish
 */
import { test, expect } from 'deepspace/testing'

// A fresh account each time: FINISH_ACCOUNT names it (default "Schema dana").
const ACCOUNT = process.env.FINISH_ACCOUNT ?? 'Schema dana'

test('fresh account: Add workspace, starter papers, add paper, next up, finish, read again', async ({ users }) => {
  const [fresh] = await users([ACCOUNT])
  const page = fresh.page
  await page.emulateMedia({ reducedMotion: 'reduce' }) // static graph, so clicks are stable

  await page.goto('/home')
  await expect(page.getByTestId('sidebar-allowance')).toHaveAttribute('data-remaining', /\d+/, { timeout: 20_000 })
  console.log(`[finish] new papers left today: ${await page.getByTestId('sidebar-allowance').getAttribute('data-remaining')}`)

  const name = `Machine Learning ${new Date().toISOString().slice(11, 16)}`
  await page.getByTestId('add-open').first().click()
  await page.getByTestId('add-choice-workspace').click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByLabel('Workspace description').fill('Transformers and attention, starting from the basics')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 20_000 })
  await expect(page.getByTestId('suggestion').first()).toBeVisible({ timeout: 90_000 })
  console.log(`[finish] starter suggestions: ${(await page.getByTestId('suggestion').allInnerTexts()).map((t) => t.split('\n')[1]).join(' | ')}`)

  await page.getByTestId('add-paper-open').click()
  await page.getByTestId('add-paper-input').fill('https://arxiv.org/abs/1706.03762')
  await page.getByTestId('add-paper-lookup').click()
  await expect(page.getByTestId('add-paper-status')).toContainText('Already analyzed', { timeout: 20_000 })
  await expect(page.getByTestId('dest-existing')).toBeChecked()
  await page.getByTestId('add-paper-submit').click()
  await expect(page).toHaveURL(/\/w\/[^/]+\/p\/1706~03762$/, { timeout: 20_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })

  const next = page.getByTestId('next-up')
  await expect(next).toBeVisible()
  const label = (await next.textContent()) ?? ''
  console.log(`[finish] ${label}`)
  await next.click()
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await expect(page.getByTestId('branch-links')).toHaveAttribute('data-links', 'ready', { timeout: 30_000 })
  const card = page.locator('[data-testid="concept-card"][data-next-up="true"]')
  const key = await card.getAttribute('data-concept-key')
  const branchKey = await page.locator('[data-testid="branch"][aria-expanded="true"]').getAttribute('data-branch-key')
  await card.getByTestId('status-known').click()
  await expect(page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)).toHaveAttribute('data-status', 'known')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('next-up')).not.toHaveText(label)

  await page.reload()
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await page.locator(`[data-testid="branch"][data-branch-key="${branchKey}"]`).click()
  await expect(page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)).toHaveAttribute('data-status', 'known', { timeout: 20_000 })
  await page.keyboard.press('Escape')

  await page.getByTestId('finish-toggle').first().click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('sequence-done')).toContainText('All concepts known')

  await page.goto('/library')
  await page.getByRole('button', { name: 'Finished', exact: true }).click()
  const lib = page.locator('[data-testid="library-row"]').filter({ hasText: 'arXiv 1706.03762' })
  await expect(lib).toHaveAttribute('data-status', 'finished')
  await lib.getByTestId('library-read-again').click()
  await page.getByRole('button', { name: 'In progress', exact: true }).click()
  await expect(page.locator('[data-testid="library-row"]').filter({ hasText: 'arXiv 1706.03762' })).toHaveAttribute('data-status', 'reading')

  await page.goto('/knowledge')
  await expect(page.getByTestId('knowledge-known').getByTestId('knowledge-item').first()).toBeVisible({ timeout: 20_000 })
  console.log(`[finish] known topics after finishing: ${await page.getByTestId('knowledge-known').getByTestId('knowledge-item').count()}`)
})
