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

/** Drifting nodes never settle for Playwright's stability check, so specs run with the static graph. */
async function calm(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

async function openReadyFixturePaper(page: Page) {
  await calm(page)
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

/** Open a branch's panel, closing any panel that is already open. */
async function openBranch(page: Page, key: string) {
  const panel = page.getByTestId('branch-panel')
  if (await panel.isVisible()) {
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  }
  await page.locator(`[data-testid="branch"][data-branch-key="${key}"]`).click()
  await expect(panel).toBeVisible()
}

function branchKnown(page: Page, key: string) {
  return page.locator(`[data-testid="branch"][data-branch-key="${key}"] [data-testid="branch-progress"]`)
}

/** Put a concept's topic back to "not known" through the UI. */
async function resetStatus(page: Page, key: string) {
  const c = card(page, key)
  const s = await c.getAttribute('data-status')
  if (s === 'known') await c.getByTestId('status-known').click()
  else if (s === 'learning') await c.getByTestId('status-learning').click()
  await expect(c).toHaveAttribute('data-status', 'unknown')
}

test('analyze a paper end to end: graph, panel, lazy links, sequence, walkthrough chips', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)

  await expect(page.getByTestId('paper-title')).toHaveText('A Fixture Paper on Curvature-Aware Attention')
  await expect(page.getByTestId('paper-graph')).toHaveAttribute('data-mode', 'graph')
  // Nodes follow the recommended sequence: mean tiers foundations 0, attention 1, geometry 2, other 3.
  const branchKeys = await page.getByTestId('branch').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch-key')))
  expect(branchKeys).toEqual(['foundations', 'attention', 'geometry', 'other'])
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toHaveAttribute('data-step', '1')

  await openBranch(page, 'foundations')
  await expect(card(page, 'c1').locator('blockquote')).toContainText('The softmax function turns a vector')
  // Opening a branch loads its links when any topic has none (cached afterwards).
  await expect(page.getByTestId('branch-links')).toHaveAttribute('data-links', 'ready', { timeout: 20_000 })
  await expect(card(page, 'c1').getByTestId('concept-resources')).toBeVisible()

  // Esc closes the panel and focus returns to the branch that opened it.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('branch-panel')).toHaveCount(0)
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toBeFocused()

  // The invented quote failed verification, so it is not shown.
  await openBranch(page, 'other')
  await expect(card(page, 'c4').locator('blockquote')).toHaveCount(0)

  // Prerequisite chips open the concept they name, in its branch.
  await openBranch(page, 'geometry')
  await card(page, 'c3').getByRole('button', { name: 'Attention as a weighted average' }).click()
  await expect(page.getByTestId('branch-panel')).toContainText('Attention')
  await expect(card(page, 'c2')).toBeVisible()
  await page.keyboard.press('Escape')

  // Walkthrough chips open the concept too.
  await page.getByTestId('view-walkthrough').click()
  await expect(page.getByTestId('walkthrough').locator('li')).toHaveCount(3)
  await page.getByTestId('walkthrough-chip').filter({ hasText: 'Second fundamental form' }).first().click()
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await expect(card(page, 'c3')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('view-branches').click()
})

test('recommended sequence: next up follows prerequisites and opens the concept', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // Reset the four fixture topics to "not known".
  for (const [branch, key] of [['foundations', 'c1'], ['attention', 'c2'], ['geometry', 'c3'], ['other', 'c4']] as const) {
    await openBranch(page, branch)
    await resetStatus(page, key)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Softmax over scores')
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toHaveAttribute('data-current', 'true')
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"] [data-testid="branch-current"]')).toHaveText('Start here')

  await page.getByTestId('next-up').click()
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await expect(card(page, 'c1')).toHaveAttribute('data-next-up', 'true')
  await card(page, 'c1').getByTestId('status-known').click()
  await page.keyboard.press('Escape')
  // c2 depends on c1, which is now known, so it is next.
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Attention as a weighted average')
  await expect(page.locator('[data-testid="sequence-step"][data-state="done"]')).toContainText('Foundations')
  await expect(page.locator('[data-testid="branch"][data-branch-key="attention"] [data-testid="branch-current"]')).toHaveText('Continue')
})

test('three-state status control, saved per reader; the paper is shared', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  await openReadyFixturePaper(ada.page)
  await openBranch(ada.page, 'foundations')
  const c1 = card(ada.page, 'c1')
  await resetStatus(ada.page, 'c1')
  const progress = branchKnown(ada.page, 'foundations')
  await expect(progress).toHaveAttribute('data-known', '0')

  await c1.getByTestId('status-learning').click()
  await expect(c1).toHaveAttribute('data-status', 'learning')
  await expect(progress).toHaveAttribute('data-known', '0')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(progress).toHaveAttribute('data-known', '1')

  await ada.page.reload()
  await openBranch(ada.page, 'foundations')
  await expect(card(ada.page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })

  await ada.page.goto('/knowledge')
  await expect(ada.page.locator('[data-testid="knowledge-item"][data-topic-key="softmax-function"]')).toBeVisible()

  await calm(bob.page)
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

test('Add flow, workspace path: starter papers appear as candidates, added papers become nodes', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  await page.goto('/home')
  const name = `[fixture] Attention basics ${Date.now()}`
  await page.getByTestId('add-open').first().click()
  await expect(page.getByTestId('add-dialog')).toBeVisible()
  await expect(page.getByTestId('add-allowance')).toContainText('new papers left today')
  await page.getByTestId('add-choice-workspace').click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 15_000 })
  await expect(page.getByTestId('workspace-graph')).toHaveAttribute('data-mode', 'graph')

  // Starter recommendations run once on creation; the fixture ranking keeps two real papers.
  await expect(page.getByTestId('suggestion')).toHaveCount(2, { timeout: 15_000 })
  await page.getByTestId('pick-suggestion').first().click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(1, { timeout: 15_000 })
  await page.getByTestId('pick-suggestion').first().click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.getByTestId('suggestion')).toHaveCount(0)

  // "+ Add paper" inside the workspace preselects it and opens the paper window.
  await page.getByTestId('add-paper-open').click()
  await page.getByTestId('add-paper-input').fill(FIXTURE_ID)
  await page.getByTestId('add-paper-lookup').click()
  await expect(page.getByTestId('add-paper-title')).toHaveText('A Fixture Paper on Curvature-Aware Attention')
  await expect(page.getByTestId('dest-existing')).toBeChecked()
  await page.getByTestId('add-paper-submit').click()
  await expect(page).toHaveURL(new RegExp(`/w/[^/]+/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  await expect(page.getByTestId('paper-back')).toContainText(name)

  if (await page.getByTestId('read-again').isVisible()) await page.getByTestId('read-again').click()
  await page.getByTestId('finish-toggle').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('paper-back').click()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(3)
  await expect(page.locator(`[data-testid="workspace-paper"][data-arxiv="${FIXTURE_ID}"]`)).toHaveAttribute('data-status', 'finished')
  await expect(page.getByTestId('workspace-continue')).toContainText('Continue')
  await expect(page.getByTestId('sidebar-workspaces')).toContainText(name)
})

test('Add flow, paper path: look up, suggested workspace name, bad links leave nothing behind', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  await page.goto('/home')
  await page.getByTestId('add-open').first().click()
  await page.getByTestId('add-choice-paper').click()
  await page.getByTestId('add-paper-input').fill('definitely not a paper')
  await page.getByTestId('add-paper-lookup').click()
  await expect(page.getByTestId('add-error')).toContainText('does not look like an arXiv link')
  await expect(page.getByTestId('add-paper-preview')).toHaveCount(0)

  await page.getByTestId('add-paper-input').fill(`https://arxiv.org/abs/${FIXTURE_ID}`)
  await page.getByTestId('add-paper-lookup').click()
  await expect(page.getByTestId('add-paper-status')).toContainText('Already analyzed')
  await expect(page.getByTestId('dest-name')).toHaveValue('Machine Learning')
  const name = `[fixture] ML from a paper ${Date.now()}`
  await page.getByTestId('dest-name').fill(name)
  await expect(page.getByTestId('dest-new')).toBeChecked()
  await page.getByTestId('add-paper-submit').click()
  await expect(page).toHaveURL(new RegExp(`/w/[^/]+/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  await expect(page.getByTestId('paper-back')).toContainText(name)
  await expect(page.getByTestId('sidebar-workspaces')).toContainText(name)
})

test('first-run prompt shows for an empty knowledge profile and can be dismissed', async ({ users }) => {
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await page.goto('/home')
  await page.evaluate(() => localStorage.removeItem('schema:first-run-dismissed'))
  await page.reload()
  await expect(page.getByTestId('home-page')).toBeVisible()
  // Bob never marks anything in these specs, so his profile is empty.
  await expect(page.getByTestId('first-run')).toContainText('Tell Schema what you already know')
  await page.getByTestId('first-run-dismiss').click()
  await expect(page.getByTestId('first-run')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('first-run')).toHaveCount(0)
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
  await expect(page.getByTestId('sequence-done')).toContainText('All concepts known')
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toHaveAttribute('data-status', 'known')
  await page.keyboard.press('Escape')

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
  await calm(page)
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
  await calm(page)
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('demo-banner')).toContainText("Demo: your progress isn't saved")
  await openBranch(page, 'foundations')
  const c1 = card(page, 'c1')
  await expect(c1).toHaveAttribute('data-status', 'unknown')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(branchKnown(page, 'foundations')).toHaveAttribute('data-known', '1')
  // The sequence uses the local demo state too.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Attention as a weighted average')
  // Nothing was saved: a reload starts over.
  await page.reload()
  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'unknown', { timeout: 15_000 })
  // c3 has no cached explanation, so generating one asks for sign-in.
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3').getByTestId('explain-signin')).toBeVisible()
})

test('landing shows the bundled example graph and a branch panel', async ({ page }) => {
  await calm(page)
  await page.goto('/')
  const example = page.getByTestId('landing-example')
  await expect(example).toContainText('Example: real output for arXiv 1706.03762')
  await expect(page.getByTestId('landing-graph')).toHaveAttribute('data-mode', 'graph')
  const branches = page.getByTestId('landing-branch')
  expect(await branches.count()).toBeGreaterThanOrEqual(3)
  await branches.nth(1).click()
  await expect(page.getByTestId('landing-panel')).toBeVisible()
  expect(await page.getByTestId('landing-branch-concepts').locator('li').count()).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('landing-panel')).toHaveCount(0)
  await expect(page.getByTestId('landing-demo')).toHaveAttribute('href', '/p/1706~03762')
})

test('bad input shows a clear error', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home')
  await ada.page.getByTestId('analyze-input').fill('not a paper')
  await ada.page.getByTestId('analyze-submit').click()
  await expect(ada.page.getByTestId('analyze-error')).toContainText('does not look like an arXiv link')
})
