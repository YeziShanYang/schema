/**
 * End-to-end specs for Schema's core flows against the local runtime.
 *
 * External services are mocked at the integration boundary: in a local test
 * run (ALLOW_DEBUG_ROUTES=true) papers whose id starts with "0000." and
 * workspaces named "[fixture] …" get canned CloudConvert / Claude / Exa /
 * arXiv responses (src/server/pipeline/fixtures.ts). Fixture ids ending in
 * 9999 behave like a scanned PDF and fail. The server actions, the analyze
 * job, the record rooms, RBAC and the UI all run for real.
 *
 * The specs are re-runnable against persisted local state: a fixture paper
 * analyzed earlier is reused, and each spec resets the state it checks.
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

/** Put a concept's topic back to "not known" through the UI. */
async function resetStatus(page: Page, key: string) {
  const c = card(page, key)
  const s = await c.getAttribute('data-status')
  if (s === 'known') await c.getByTestId('status-known').click()
  else if (s === 'learning') await c.getByTestId('status-learning').click()
  await expect(c).toHaveAttribute('data-status', 'unknown')
}

test('analyze a paper end to end: branches, quotes, lazy links, walkthrough chips', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)

  await expect(page.getByTestId('paper-title')).toHaveText('A Fixture Paper on Curvature-Aware Attention')
  const branchKeys = await page.getByTestId('branch').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch-key')))
  expect(branchKeys).toEqual(['foundations', 'attention', 'geometry', 'other'])

  await openBranch(page, 'foundations')
  await expect(card(page, 'c1').locator('blockquote')).toContainText('The softmax function turns a vector')

  // Links are loaded per branch on demand (cached afterwards).
  const load = page.getByTestId('load-links')
  if (await load.isVisible()) await load.click()
  await expect(page.getByTestId('branch-links')).toHaveAttribute('data-links', 'ready', { timeout: 20_000 })
  await expect(card(page, 'c1').getByTestId('concept-resources')).toBeVisible()

  // The invented quote failed verification, so it is not shown.
  await openBranch(page, 'other')
  await expect(card(page, 'c4').locator('blockquote')).toHaveCount(0)

  // Prerequisite chips open the concept they name.
  await openBranch(page, 'geometry')
  await card(page, 'c3').getByRole('button', { name: 'Attention as a weighted average' }).click()
  await expect(page.locator('[data-testid="branch"][data-branch-key="attention"]')).toHaveAttribute('aria-pressed', 'true')

  // Walkthrough chips open the concept too.
  await page.getByTestId('view-walkthrough').click()
  await expect(page.getByTestId('walkthrough').locator('li')).toHaveCount(3)
  await page.getByTestId('walkthrough-chip').filter({ hasText: 'Second fundamental form' }).first().click()
  await expect(card(page, 'c3')).toBeVisible()
  await expect(page.locator('[data-testid="branch"][data-branch-key="geometry"]')).toHaveAttribute('aria-pressed', 'true')
})

test('three-state status control, saved per reader; the paper is shared', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  await openReadyFixturePaper(ada.page)
  await openBranch(ada.page, 'foundations')
  const c1 = card(ada.page, 'c1')
  await resetStatus(ada.page, 'c1')
  const progress = ada.page.locator('[data-branch-key="foundations"] [data-testid="branch-progress"]')
  await expect(progress).toHaveText('0/1')

  await c1.getByTestId('status-learning').click()
  await expect(c1).toHaveAttribute('data-status', 'learning')
  await expect(progress).toHaveText('0/1')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(progress).toHaveText('1/1')

  await ada.page.reload()
  await openBranch(ada.page, 'foundations')
  await expect(card(ada.page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })

  await ada.page.goto('/knowledge')
  await expect(ada.page.locator('[data-testid="knowledge-item"][data-topic-key="softmax-function"]')).toBeVisible()

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
  await resetStatus(page, 'c2')

  await c2.getByTestId('check-toggle').click()
  await c2.getByTestId('check-choice').nth(1).click() // "Value vectors" is the fixture's correct answer
  await expect(c2.getByTestId('check-result')).toContainText('Correct')
  await expect(c2).toHaveAttribute('data-status', 'known')

  const explain = c2.getByTestId('explain-button')
  if (await explain.isVisible()) {
    await explain.click() // a fresh explanation opens on its own
  } else {
    await c2.getByTestId('explain-toggle').click() // a cached one starts collapsed
  }
  await expect(c2.getByTestId('concept-explanation')).toContainText('Worked example', { timeout: 15_000 })
})

test('workspace: create, recommend, add two papers, open one, finish and reopen', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  const name = `[fixture] Attention basics ${Date.now()}`
  await page.getByTestId('new-workspace').click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 15_000 })

  await page.getByTestId('recommend-button').click()
  // The fixture ranking picks results 1, 2 and an invented number 9; only the two real ones survive.
  await expect(page.getByTestId('suggestion')).toHaveCount(2, { timeout: 15_000 })

  // Adding both keeps both: a workspace holds several papers at once.
  await page.getByTestId('pick-suggestion').first().click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(1, { timeout: 15_000 })
  await page.getByTestId('pick-suggestion').first().click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.getByTestId('suggestion')).toHaveCount(0)
  await page.getByTestId('analyze-input').fill(FIXTURE_ID)
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(3, { timeout: 15_000 })

  const row = page.locator(`[data-testid="workspace-paper"][data-arxiv="${FIXTURE_ID}"]`)
  await row.getByTestId('workspace-paper-toggle').click()
  await expect(row).toHaveAttribute('data-status', 'finished')
  await row.getByTestId('workspace-paper-toggle').click()
  await expect(row).toHaveAttribute('data-status', 'active')

  await row.getByTestId('workspace-paper-link').click()
  await expect(page).toHaveURL(new RegExp(`/p/${FIXTURE_SLUG}$`))
  await expect(page.getByTestId('sidebar-workspaces')).toContainText(name)
})

test('finishing a paper can mark its remaining topics known; Read again reopens it', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('read-again').isVisible()) await page.getByTestId('read-again').click()
  await page.getByTestId('finish-toggle').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toHaveAttribute('data-status', 'known')

  await page.goto('/library')
  await page.getByRole('button', { name: 'Finished' }).click()
  const row = page.locator('[data-testid="library-row"][data-status="finished"]').filter({ hasText: `arXiv ${FIXTURE_ID}` })
  await expect(row).toBeVisible()
  await row.getByTestId('library-read-again').click()
  await page.getByRole('button', { name: 'In progress' }).click()
  await expect(page.locator('[data-testid="library-row"][data-status="reading"]').filter({ hasText: `arXiv ${FIXTURE_ID}` })).toBeVisible()
})

test('a failed analysis does not use up a daily slot', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  const allowance = page.getByTestId('sidebar-allowance')
  await expect(allowance).toHaveAttribute('data-remaining', /\d+/, { timeout: 15_000 })
  const before = Number(await allowance.getAttribute('data-remaining'))
  test.skip(before === 0, 'Ada is at the daily cap in this local state')

  const failing = `0000.${Math.floor(1 + Math.random() * 8)}9999`
  await page.getByTestId('analyze-input').fill(failing)
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: READY_TIMEOUT })
  await expect(page.getByTestId('paper-failed')).toContainText('almost no extractable text')
  await page.goto('/home')
  await expect(page.getByTestId('sidebar-allowance')).toHaveAttribute('data-remaining', String(before), { timeout: 15_000 })
})

test('the daily cap refuses a sixth new paper', async ({ users }) => {
  test.setTimeout(150_000)
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  let refused = ''
  for (let i = 0; i < 6 && !refused; i++) {
    const id = `0000.${String(Math.floor(10000 + Math.random() * 89990))}`
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

test('signed-out demo: status changes stay local, links and AI need sign-in', async ({ page }) => {
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('demo-banner')).toContainText("Demo: your progress isn't saved")
  await openBranch(page, 'foundations')
  const c1 = card(page, 'c1')
  await expect(c1).toHaveAttribute('data-status', 'unknown')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(page.locator('[data-branch-key="foundations"] [data-testid="branch-progress"]')).toHaveText('1/1')
  // Nothing was saved: a reload starts over.
  await page.reload()
  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'unknown', { timeout: 15_000 })
  // c3 has no cached explanation, so generating one asks for sign-in.
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3').getByTestId('explain-signin')).toBeVisible()
})

test('landing shows the bundled example and its branches switch the concept list', async ({ page }) => {
  await page.goto('/')
  const example = page.getByTestId('landing-example')
  await expect(example).toContainText('Example: real output for arXiv 1706.03762')
  await expect(example).toContainText('Attention Is All You Need')
  const branches = page.getByTestId('landing-branch')
  expect(await branches.count()).toBeGreaterThanOrEqual(3)
  const firstList = await page.getByTestId('landing-branch-concepts').innerText()
  await branches.nth(1).click()
  await expect(branches.nth(1)).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByTestId('landing-branch-concepts').innerText()).not.toBe(firstList)
  await expect(page.getByTestId('landing-demo')).toHaveAttribute('href', '/p/1706~03762')
})

test('bad input shows a clear error', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home')
  await ada.page.getByTestId('analyze-input').fill('not a paper')
  await ada.page.getByTestId('analyze-submit').click()
  await expect(ada.page.getByTestId('analyze-error')).toContainText('does not look like an arXiv link')
})
