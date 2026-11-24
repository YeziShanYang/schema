/**
 * Live finish-condition check on the deployed app, with real CloudConvert,
 * Claude, Exa and arXiv calls. Each run of the analysis step costs credits,
 * so it analyzes one paper (LIVE_PAPER) and reuses it if already analyzed.
 */
import { test, expect } from 'deepspace/testing'

const PAPER = process.env.LIVE_PAPER ?? '2611.29224'
const SLUG = PAPER.replace(/\//g, '_').replace(/\./g, '~')

test.describe.configure({ mode: 'serial' })

test('analyze a real paper, track knowledge, explain a concept, share with a second reader', async ({ users }) => {
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  const page = ada.page

  await page.goto('/home')
  await page.getByTestId('analyze-input').fill(`https://arxiv.org/abs/${PAPER}`)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${SLUG}$`), { timeout: 30_000 })
  const paperPage = page.getByTestId('paper-page')
  const started = Date.now()
  await expect(paperPage).toHaveAttribute('data-paper-status', /ready|failed/, { timeout: 8 * 60_000 })
  console.log(`[live] status ${await paperPage.getAttribute('data-paper-status')} after ${Math.round((Date.now() - started) / 1000)}s`)
  await expect(paperPage).toHaveAttribute('data-paper-status', 'ready')

  const branches = page.getByTestId('branch')
  const branchCount = await branches.count()
  console.log(`[live] branches: ${branchCount}`, await branches.allInnerTexts())
  expect(branchCount).toBeGreaterThanOrEqual(2)

  // Walk every branch and count concepts, quotes and resources.
  let concepts = 0
  let quotes = 0
  let withResources = 0
  for (let i = 0; i < branchCount; i++) {
    await branches.nth(i).click()
    const cards = page.getByTestId('branch-concepts').getByTestId('concept-card')
    const n = await cards.count()
    concepts += n
    for (let j = 0; j < n; j++) {
      if ((await cards.nth(j).locator('blockquote').count()) > 0) quotes++
      if ((await cards.nth(j).getByTestId('concept-resources').count()) > 0) withResources++
    }
  }
  console.log(`[live] concepts=${concepts} verifiedQuotes=${quotes} withResources=${withResources}`)
  expect(concepts).toBeGreaterThanOrEqual(6)
  expect(withResources).toBeGreaterThan(0)

  // Mark the first concept of the first branch known; it survives a reload.
  await branches.first().click()
  const first = page.getByTestId('branch-concepts').getByTestId('concept-card').first()
  const key = await first.getAttribute('data-concept-key')
  if ((await first.getAttribute('data-status')) !== 'known') await first.getByTestId('mark-known').click()
  await expect(first).toHaveAttribute('data-status', 'known')
  await page.reload()
  await page.getByTestId('branch').first().click()
  await expect(page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)).toHaveAttribute('data-status', 'known', { timeout: 20_000 })

  // Explain with AI on the second concept (cached afterwards).
  const second = page.getByTestId('branch-concepts').getByTestId('concept-card').nth(1)
  if ((await second.getByTestId('explain-button').count()) > 0) await second.getByTestId('explain-button').click()
  else await second.getByTestId('explain-toggle').click()
  await expect(second.getByTestId('concept-explanation')).toBeVisible({ timeout: 90_000 })
  console.log(`[live] explanation: ${(await second.getByTestId('concept-explanation').innerText()).slice(0, 300)}`)

  // Walkthrough exists.
  await page.getByTestId('view-walkthrough').click()
  const sections = await page.getByTestId('walkthrough').locator('li').count()
  console.log(`[live] walkthrough sections=${sections}`)
  expect(sections).toBeGreaterThan(0)

  // A second reader sees the shared analysis right away, without Ada's progress.
  await bob.page.goto(`/p/${SLUG}`)
  await expect(bob.page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 30_000 })
  await bob.page.getByTestId('branch').first().click()
  await expect(bob.page.locator(`[data-testid="concept-card"][data-concept-key="${key}"]`)).not.toHaveAttribute('data-status', 'known')
})

test('workspace recommendations are real arXiv papers; a pasted cached paper becomes the target', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  const name = `Machine Learning ${new Date().toISOString().slice(0, 16)}`
  await page.getByLabel('Workspace name').fill(name)
  await page.getByLabel('Workspace description').fill('Representation learning and probing')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 20_000 })

  await page.getByTestId('recommend-button').click()
  await expect(page.getByTestId('suggestion').first()).toBeVisible({ timeout: 90_000 })
  const suggestions = await page.getByTestId('suggestion').allInnerTexts()
  console.log(`[live] suggestions:\n${suggestions.join('\n---\n')}`)
  expect(suggestions.length).toBeGreaterThan(0)

  await page.getByTestId('analyze-input').fill(PAPER)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${SLUG}$`), { timeout: 30_000 })
  await page.goBack()
  await expect(page.getByTestId('target-link')).toBeVisible({ timeout: 20_000 })
})

test('failure states: bad input and a paper that does not exist', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  await page.getByTestId('analyze-input').fill('hello world')
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('analyze-error')).toContainText('does not look like an arXiv link')
  await page.getByTestId('analyze-input').fill('2611.99999')
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('analyze-error')).toContainText('arXiv has no paper', { timeout: 30_000 })
  // Fixture ids only work in local test runs.
  await page.getByTestId('analyze-input').fill('0000.00001')
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('analyze-error')).toContainText('does not look like an arXiv link', { timeout: 30_000 })
  await page.goto('/p/2611~99999')
  await expect(page.getByTestId('paper-missing')).toBeVisible({ timeout: 20_000 })
})
