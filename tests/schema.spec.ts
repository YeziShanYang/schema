/**
 * End-to-end specs for Schema's core flows against the local runtime.
 *
 * External services are mocked at the integration boundary: in a local test
 * run (ALLOW_DEBUG_ROUTES=true) papers whose id starts with "0000." and
 * workspaces named "[fixture] …" get canned CloudConvert / Claude / Exa /
 * arXiv responses (src/server/pipeline/fixtures.ts). The server actions, the
 * analyze job, the record rooms, RBAC and the UI all run for real.
 *
 * The specs are written to be re-runnable against a persisted local state:
 * a fixture paper analyzed in an earlier run is reused, and assertions reset
 * the state they depend on first.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const usable = loadAllTestAccounts().length
test.skip(usable < 2, `Needs 2 test accounts, found ${usable}. Create them with \`npx deepspace test accounts create\`.`)

test.describe.configure({ mode: 'serial' })

const FIXTURE_ID = '0000.00001'
const FIXTURE_SLUG = '0000~00001'
const READY_TIMEOUT = 90_000

async function openReadyFixturePaper(page: Page) {
  await page.goto('/home')
  await page.getByTestId('analyze-input').fill(FIXTURE_ID)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  // A failed earlier run is retried through the UI (the requester sees Retry).
  const paperPage = page.getByTestId('paper-page')
  await expect(paperPage).toHaveAttribute('data-paper-status', /ready|failed/, { timeout: READY_TIMEOUT })
  if ((await paperPage.getAttribute('data-paper-status')) === 'failed') {
    await page.getByTestId('paper-failed').getByRole('button', { name: 'Retry' }).click()
  }
  await expect(paperPage).toHaveAttribute('data-paper-status', 'ready', { timeout: READY_TIMEOUT })
}

function card(page: Page, key: string) {
  return page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)
}

async function openBranch(page: Page, key: string) {
  await page.locator(`[data-testid="branch"][data-branch-key="${key}"]`).click()
}

test('analyze a paper end to end: branches, tiers, quotes, resources, walkthrough', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)

  await expect(page.getByTestId('paper-title')).toHaveText('A Fixture Paper on Curvature-Aware Attention')
  // Three model branches plus "Other concepts" for the concept with an unknown branch key.
  const branchKeys = await page.getByTestId('branch').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch-key')))
  expect(branchKeys).toEqual(['foundations', 'attention', 'geometry', 'other'])

  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toBeVisible()
  await expect(card(page, 'c1').locator('blockquote')).toContainText('The softmax function turns a vector')
  await expect(card(page, 'c1').getByTestId('concept-resources')).toBeVisible()

  // The invented quote failed verification, so it is not shown.
  await openBranch(page, 'other')
  await expect(card(page, 'c4')).toBeVisible()
  await expect(card(page, 'c4').locator('blockquote')).toHaveCount(0)

  // c3 depended on a missing concept (c9); only the real prerequisite remains.
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toContainText('Learn first: Attention as a weighted average')

  await page.getByTestId('view-walkthrough').click()
  await expect(page.getByTestId('walkthrough').locator('li')).toHaveCount(3)
})

test('knowledge is private per reader while the paper is shared', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  await openReadyFixturePaper(ada.page)
  await openBranch(ada.page, 'foundations')
  const c1 = card(ada.page, 'c1')

  // Reset, then mark known.
  if (await c1.getByTestId('mark-clear').isVisible()) await c1.getByTestId('mark-clear').click()
  await expect(c1).toHaveAttribute('data-status', 'unknown')
  await expect(ada.page.locator('[data-branch-key="foundations"] [data-testid="branch-progress"]')).toHaveText('0/1')
  await c1.getByTestId('mark-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(ada.page.locator('[data-branch-key="foundations"] [data-testid="branch-progress"]')).toHaveText('1/1')

  // Persists across a reload.
  await ada.page.reload()
  await openBranch(ada.page, 'foundations')
  await expect(card(ada.page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })

  // Shows up in Ada's knowledge profile.
  await ada.page.goto('/knowledge')
  await expect(ada.page.locator('[data-testid="knowledge-item"][data-topic-key="softmax-function"]')).toBeVisible()

  // Bob sees the same paper but none of Ada's progress.
  await bob.page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(bob.page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await openBranch(bob.page, 'foundations')
  await expect(card(bob.page, 'c1')).toHaveAttribute('data-status', 'unknown')
  await bob.page.goto('/knowledge')
  await expect(bob.page.getByTestId('knowledge-page')).toBeVisible()
  await expect(bob.page.locator('[data-testid="knowledge-item"][data-topic-key="softmax-function"]')).toHaveCount(0)
})

test('a correct check answer marks the topic known; Explain with AI is cached on the concept', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  await openBranch(page, 'attention')
  const c2 = card(page, 'c2')
  if (await c2.getByTestId('mark-clear').isVisible()) await c2.getByTestId('mark-clear').click()
  await expect(c2).toHaveAttribute('data-status', 'unknown')

  await c2.getByTestId('concept-check').locator('summary').click()
  await c2.getByTestId('check-choice').nth(1).click() // "Value vectors" is the fixture's correct answer
  await expect(c2.getByTestId('check-result')).toContainText('Correct')
  await expect(c2).toHaveAttribute('data-status', 'known')

  const explain = c2.getByTestId('explain-button')
  if (await explain.isVisible()) await explain.click()
  await expect(c2.getByTestId('concept-explanation')).toContainText('Worked example', { timeout: 15_000 })
})

test('workspace: recommend papers, pick one, it becomes the target', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  const name = `[fixture] Attention basics ${Date.now()}`
  await page.getByLabel('Workspace name').fill(name)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 15_000 })

  await page.getByTestId('recommend-button').click()
  // The fixture ranking picks results 1, 2 and an invented number 9; only the two real ones survive.
  await expect(page.getByTestId('suggestion')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.getByTestId('suggestion').first()).toContainText('arXiv 0000.00011')

  await page.getByTestId('pick-suggestion').first().click()
  await expect(page).toHaveURL(/\/p\/0000~00011$/, { timeout: 15_000 })
  await page.goBack()
  await expect(page.getByTestId('target-link')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('workspace-history')).toContainText('current')
})

test('finishing a paper can mark its remaining topics known and moves it to Finished', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('finish-toggle').isVisible()) {
    await page.getByTestId('finish-toggle').click()
    await page.getByTestId('finish-confirm').click()
  }
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toHaveAttribute('data-status', 'known')
  await page.goto('/library')
  await page.getByRole('button', { name: 'Finished' }).click()
  await expect(page.locator('[data-testid="library-row"][data-status="finished"]').first()).toBeVisible()
})

test('the daily cap refuses a sixth new paper', async ({ users }) => {
  test.setTimeout(150_000)
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await page.goto('/home')
  let refused = ''
  for (let i = 0; i < 6 && !refused; i++) {
    const id = `0000.${String(Math.floor(10000 + Math.random() * 89999))}`
    await page.goto('/home')
    await page.getByTestId('analyze-input').fill(id)
    await page.getByTestId('analyze-submit').click()
    const outcome = await Promise.race([
      page.waitForURL(/\/p\//, { timeout: 15_000 }).then(() => 'ok'),
      page.getByTestId('analyze-error').waitFor({ timeout: 15_000 }).then(() => 'error'),
    ])
    if (outcome === 'error') refused = (await page.getByTestId('analyze-error').textContent()) ?? ''
  }
  expect(refused).toContain('daily limit')
})

test('signed-out visitors can read an analyzed paper but get no progress controls', async ({ page }) => {
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('branch').first()).toBeVisible()
  await expect(page.getByTestId('concept-card').first()).toBeVisible()
  await expect(page.getByTestId('concept-status-controls')).toHaveCount(0)
  await expect(page.getByTestId('paper-progress-count')).toContainText('concepts')
})

test('bad input shows a clear error', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home')
  await ada.page.getByTestId('analyze-input').fill('not a paper')
  await ada.page.getByTestId('analyze-submit').click()
  await expect(ada.page.getByTestId('analyze-error')).toContainText('does not look like an arXiv link')
})
