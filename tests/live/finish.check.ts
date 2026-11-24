/**
 * Finish condition on the deployed app for a fresh account ("Schema cara"):
 * create a workspace, get real recommendations, add the (cached) demo paper,
 * open a branch with cached links, mark a concept known, reload, finish, read
 * again. Only the recommendation run costs credits.
 *
 *   npx playwright test -c tests/live/playwright.live.config.ts finish
 */
import { test, expect } from 'deepspace/testing'

test('fresh account: workspace, recommend, add paper, learn, finish, read again', async ({ users }) => {
  const [cara] = await users(['Schema cara'])
  const page = cara.page

  await page.goto('/home')
  await expect(page.getByTestId('sidebar-allowance')).toHaveAttribute('data-remaining', /\d+/, { timeout: 20_000 })
  console.log(`[finish] allowance: ${await page.getByTestId('sidebar-allowance').innerText()}`)

  const name = `Machine Learning ${new Date().toISOString().slice(11, 16)}`
  await page.getByTestId('new-workspace').click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByLabel('Workspace description').fill('Transformers and attention, starting from the basics')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 20_000 })

  await page.getByTestId('recommend-button').click()
  await expect(page.getByTestId('suggestion').first()).toBeVisible({ timeout: 90_000 })
  console.log(`[finish] suggestions: ${(await page.getByTestId('suggestion').allInnerTexts()).map((t) => t.split('\n')[0]).join(' | ')}`)

  await page.getByTestId('analyze-input').fill('https://arxiv.org/abs/1706.03762')
  await page.getByTestId('analyze-submit').click()
  const row = page.locator('[data-testid="workspace-paper"][data-arxiv="1706.03762"]')
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.getByTestId('workspace-paper-link').click()

  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await page.getByTestId('branch').first().click()
  await expect(page.getByTestId('branch-links')).toHaveAttribute('data-links', 'ready')
  const first = page.getByTestId('branch-concepts').getByTestId('concept-card').first()
  const key = await first.getAttribute('data-concept-key')
  await first.getByTestId('status-known').click()
  await expect(first).toHaveAttribute('data-status', 'known')
  await expect(first.getByTestId('concept-resources')).toBeVisible()

  await page.reload()
  await page.getByTestId('branch').first().click()
  await expect(page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)).toHaveAttribute('data-status', 'known', { timeout: 20_000 })

  await page.getByTestId('finish-toggle').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('paper-progress-count')).toContainText(/(\d+) \/ \1/)

  await page.goto('/library')
  await page.getByRole('button', { name: 'Finished' }).click()
  const lib = page.locator('[data-testid="library-row"]').filter({ hasText: 'arXiv 1706.03762' })
  await expect(lib).toHaveAttribute('data-status', 'finished')
  await lib.getByTestId('library-read-again').click()
  await page.getByRole('button', { name: 'In progress' }).click()
  await expect(page.locator('[data-testid="library-row"]').filter({ hasText: 'arXiv 1706.03762' })).toHaveAttribute('data-status', 'reading')

  await page.goto('/knowledge')
  const knownCount = await page.getByTestId('knowledge-known').getByTestId('knowledge-item').count()
  console.log(`[finish] known topics after finishing: ${knownCount}`)
  expect(knownCount).toBeGreaterThan(5)
})
