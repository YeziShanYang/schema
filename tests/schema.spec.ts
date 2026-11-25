/**
 * End-to-end specs for Schema's core flows against the local runtime.
 *
 * External services are mocked at the integration boundary: in a local test
 * run (ALLOW_DEBUG_ROUTES=true) papers whose id starts with "0000." and
 * workspaces named "[fixture] …" get canned CloudConvert / Claude / Exa /
 * arXiv responses (src/server/pipeline/fixtures.ts). Fixture ids ending in
 * 99 behave like a scanned PDF and fail after conversion; ids ending in 77
 * fail the conversion itself. The server actions, the analyze
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
/** A second paper analyzed from the same fixture: same concept names and topics, different concept rows. */
const SECOND_ID = '0000.00031'
const SECOND_SLUG = '0000~00031'
const FIXTURE_TITLE = 'A Fixture Paper on Curvature-Aware Attention'
/** Fixture ids ending in 44 get a title too long for one line on a phone (fixtureMeta in fixtures.ts). */
const LONG_ID = '0000.00044'
const LONG_SLUG = '0000~00044'
const READY_TIMEOUT = 90_000
/** Every fixture concept by branch, in the order the panel lists them. */
const FIXTURE_CONCEPTS = [
  ['foundations', ['c1', 'c5']],
  ['attention', ['c2', 'c6']],
  ['geometry', ['c3', 'c7', 'c9']],
  ['other', ['c4', 'c8']],
] as const

/**
 * Drifting nodes never settle for Playwright's stability check, so specs run
 * with the static graph. The fixture papers' overviews are also marked as
 * already shown in this browser, so they do not open over the graph on their
 * own (the overview spec checks that without this helper).
 */
async function calm(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((ids) => {
    for (const id of ids) localStorage.setItem(`schema:overview-shown:${id}`, '1')
  }, [FIXTURE_ID, SECOND_ID, LONG_ID])
}

/** Wait until the paper's overview and this reader's read mark have loaded. */
async function overviewState(page: Page): Promise<'read' | 'unread'> {
  const paperPage = page.getByTestId('paper-page')
  await expect(paperPage).toHaveAttribute('data-overview', /^(read|unread)$/, { timeout: 30_000 })
  return (await paperPage.getAttribute('data-overview')) as 'read' | 'unread'
}

/** Mark the overview read (or unread) through its window, opened from step 0 of the strip. */
async function setOverviewRead(page: Page, read: boolean) {
  if ((await overviewState(page)) === (read ? 'read' : 'unread')) return
  await page.getByTestId('sequence-overview').click()
  await expect(page.getByTestId('overview-window')).toBeVisible()
  await page.getByTestId('overview-read').click()
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-overview', read ? 'read' : 'unread')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('overview-window')).toHaveCount(0)
}

async function openReadyFixturePaper(page: Page, id = FIXTURE_ID) {
  await calm(page)
  await page.goto('/home')
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${id.replace('.', '~')}$`), { timeout: 15_000 })
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

/** Put a concept back to "not known" through the UI. */
async function resetStatus(page: Page, key: string) {
  const c = card(page, key)
  // A click while the previous write is in flight is ignored, so wait for the control first.
  await expect(c.getByTestId('status-known')).toBeEnabled({ timeout: 15_000 })
  const s = await c.getAttribute('data-status')
  if (s === 'known') await c.getByTestId('status-known').click()
  await expect(c).toHaveAttribute('data-status', 'unknown')
  // The control is disabled while the write is in flight.
  await expect(c.getByTestId('status-known')).toBeEnabled({ timeout: 15_000 })
}

/** Check a concept through the UI, if it is not checked already. */
async function ensureKnown(page: Page, key: string) {
  const c = card(page, key)
  await expect(c.getByTestId('status-known')).toBeEnabled({ timeout: 15_000 })
  if ((await c.getAttribute('data-status')) !== 'known') await c.getByTestId('status-known').click()
  await expect(c).toHaveAttribute('data-status', 'known')
  await expect(c.getByTestId('status-known')).toBeEnabled({ timeout: 15_000 })
}

/** Reset every fixture concept in the open paper to "not known". */
async function resetAll(page: Page) {
  for (const [branch, keys] of FIXTURE_CONCEPTS) {
    await openBranch(page, branch)
    for (const key of keys) await resetStatus(page, key)
  }
  await page.keyboard.press('Escape')
}

test('analyze a paper end to end: graph, panel, lazy links, sequence, walkthrough chips', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)

  await expect(page.getByTestId('paper-title')).toHaveText('A Fixture Paper on Curvature-Aware Attention')
  await expect(page.getByTestId('paper-graph')).toHaveAttribute('data-mode', 'graph')
  // Nodes follow the recommended sequence: mean tiers foundations 0, attention 1, geometry 2.3, other 2.5.
  const branchKeys = await page.getByTestId('branch').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch-key')))
  expect(branchKeys).toEqual(['foundations', 'attention', 'geometry', 'other'])
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toHaveAttribute('data-step', '1')

  await openBranch(page, 'foundations')
  await expect(card(page, 'c1').locator('blockquote')).toContainText('The softmax function turns a vector')
  // c5's only candidate was c1's quote, so the server found the sentence that names gradient descent.
  await expect(card(page, 'c5').locator('blockquote')).toContainText('We assume the reader knows how gradient descent updates parameters')
  // Opening a branch loads its links when any topic has none (cached afterwards).
  await expect(page.getByTestId('branch-links')).toHaveAttribute('data-links', 'ready', { timeout: 20_000 })
  await expect(card(page, 'c1').getByTestId('concept-resources')).toBeVisible()
  // Check questions are gone.
  await expect(page.getByTestId('check-toggle')).toHaveCount(0)

  // Esc closes the panel and focus returns to the branch that opened it.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('branch-panel')).toHaveCount(0)
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toBeFocused()

  // The paper text came from the HTML: c6's quote keeps its inline math and renders it with KaTeX.
  await openBranch(page, 'attention')
  await expect(card(page, 'c6').locator('blockquote')).toContainText('Each score is the dot product of a query and a key')
  await expect(card(page, 'c6').locator('blockquote .katex').first()).toBeAttached({ timeout: 10_000 })

  // The invented quote failed verification, so it is not shown; c8's lead-in quote gave way to its second one.
  await openBranch(page, 'other')
  await expect(card(page, 'c4').locator('blockquote')).toHaveCount(0)
  await expect(card(page, 'c8').locator('blockquote')).toContainText('On three benchmarks the curvature correction')

  // The one-concept "deployment" branch merged into geometry, where its prerequisites are.
  await openBranch(page, 'geometry')
  await expect(page.getByTestId('branch-concepts').getByTestId('concept-card')).toHaveCount(3)
  await expect(card(page, 'c9')).toBeVisible()
  // c7's first quote was c3's, so it shows its second.
  await expect(card(page, 'c7').locator('blockquote')).toContainText('Most prior work treats the representation space as flat')

  // Prerequisite chips open the concept they name, in its branch.
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

test('overview: opens on its own once, is step 0 until read, the read mark persists, chips open their concept', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  // Static graph, but without calm(): this spec checks the overview opening on its own.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  const paperPage = page.getByTestId('paper-page')
  const win = page.getByTestId('overview-window')
  const settled = () => expect(paperPage).toHaveAttribute('data-overview-settled', 'true', { timeout: 30_000 })
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await settled()
  // Start unread. Marking it unread here does not count as having opened on its own.
  if ((await overviewState(page)) === 'read') {
    await page.getByTestId('open-overview').click()
    await page.getByTestId('overview-read').click()
    await expect(paperPage).toHaveAttribute('data-overview', 'unread')
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
    await page.reload()
    await settled()
  }

  // First visit while unread: it opens on its own, with the story, chips and their lines.
  await expect(win).toBeVisible()
  await expect(win.getByTestId('overview-plain')).toContainText('Attention lets a model decide which words matter most')
  // Verification dropped s5, which the paper does not support, so four steps remain.
  await expect(win.getByTestId('overview-step')).toHaveCount(4)
  await expect(win).not.toContainText('twice as fast')
  await expect(win.getByTestId('overview-map')).toHaveAttribute('data-layout', 'lines')
  // c1 feeds s1 and s2, c2 feeds s2 and s3, c6 feeds s3, c3 and c7 feed s4; the unknown key is dropped.
  await expect(win.getByTestId('overview-lines').locator('path.line')).toHaveCount(7)
  const also = await win.getByTestId('overview-also').getByTestId('overview-chip').evaluateAll((els) => els.map((e) => e.getAttribute('data-concept-key')))
  // In the recommended sequence: by branch, then tier (c8 is tier 2, c4 tier 3).
  expect(also).toEqual(['c5', 'c9', 'c8', 'c4'])
  // s3's technical line was unsupported, so it has none.
  await expect(win.locator('[data-testid="overview-step"][data-item-id="s3"] [data-testid="overview-technical-toggle"]')).toHaveCount(0)
  // Hover and focus light up both ways.
  await win.locator('[data-testid="overview-chips-left"] [data-concept-key="c2"], [data-testid="overview-chips-right"] [data-concept-key="c2"]').hover()
  await expect(win.locator('[data-testid="overview-step"][data-hot="true"]')).toHaveCount(2)
  await expect(win.locator('[data-testid="overview-step"][data-item-id="s1"]')).not.toHaveAttribute('data-hot', 'true')
  await win.locator('[data-testid="overview-step"][data-item-id="s1"]').hover()
  await expect(win.locator('[data-testid="overview-lines"] path.line.hot')).toHaveCount(1)
  await expect(win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-hot="true"]')).toHaveAttribute('data-concept-key', 'c1')
  // The technical line renders through MathText.
  await win.getByTestId('overview-technical-toggle').first().click()
  await expect(win.getByTestId('overview-technical').first()).toContainText('softmax over scores')

  // Esc closes it; focus lands on the center card's Overview button.
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  await expect(page.getByTestId('open-overview')).toBeFocused()

  // Until it is read it is the current step, and Next up points at it.
  await expect(page.getByTestId('sequence-overview')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Read the overview')
  await expect(page.getByTestId('sequence-done')).toHaveCount(0)
  await expect(page.locator('[data-testid="sequence-step"][data-state="current"]')).toHaveCount(0)

  // It opened on its own once: a reload leaves it closed.
  await page.reload()
  await settled()
  await expect(paperPage).not.toHaveAttribute('data-overview-open', 'true')
  await expect(win).toHaveCount(0)

  // Next up opens it; reading it moves the sequence on.
  await page.getByTestId('next-up').click()
  await expect(win).toBeVisible()
  await expect(page.getByTestId('overview-read')).not.toBeChecked()
  await page.getByTestId('overview-read').click()
  await expect(paperPage).toHaveAttribute('data-overview', 'read')
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  // Focus returns to Next up, or to the card's Overview button when Next up became "All concepts known".
  await expect(page.locator('[data-testid="next-up"]:focus, [data-testid="open-overview"]:focus')).toHaveCount(1)
  await expect(page.getByTestId('sequence-overview')).toHaveAttribute('data-state', 'done')
  await expect(page.getByTestId('sequence-action')).not.toContainText('Read the overview')

  // The read mark is saved: after a reload step 0 is done and the box stays ticked.
  await page.reload()
  expect(await overviewState(page)).toBe('read')
  await expect(page.getByTestId('sequence-overview')).toHaveAttribute('data-state', 'done')
  // Clicking the center card (not only its button) opens it.
  await page.getByTestId('paper-card').locator('h2').click()
  await expect(win).toBeVisible()
  await expect(page.getByTestId('overview-read')).toBeChecked()

  // A chip opens its concept's branch panel at that concept.
  await win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-concept-key="c3"]').click()
  await expect(win).toHaveCount(0)
  const panel = page.getByTestId('branch-panel')
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-testid="branch"][data-branch-key="geometry"]')).toHaveAttribute('aria-expanded', 'true')
  await expect(card(page, 'c3')).toBeInViewport()
  await expect(panel.getByTestId('panel-close')).toBeFocused()

  // "Where it fits" shows the plain role; "See in overview" goes back with the concept highlighted.
  await expect(card(page, 'c3').getByTestId('concept-role')).toContainText('It measures the curve the correction follows.')
  // c9's plain role claimed a speedup the paper does not make, so verification removed it.
  await expect(card(page, 'c9').getByTestId('concept-role')).toHaveCount(0)
  await card(page, 'c3').getByTestId('see-in-overview').click()
  await expect(win).toBeVisible()
  // Move the pointer off the window so a hover does not replace the requested highlight.
  await page.mouse.move(2, 2)
  await expect(panel).toHaveCount(0)
  await expect(win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-concept-key="c3"]')).toHaveAttribute('data-hot', 'true')
  await expect(win.locator('[data-testid="overview-step"][data-item-id="s4"]')).toHaveAttribute('data-hot', 'true')
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  await expect(page.locator('[data-testid="branch"][data-branch-key="geometry"]')).toBeFocused()
})

test('the step strip is one row at 1440 and puts Next up on its own row at 390', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyFixturePaper(page)
  await overviewState(page)
  const strip = page.getByTestId('sequence-strip')
  const rows = async () =>
    strip.locator('[data-testid="sequence-overview"], [data-testid="sequence-step"], [data-testid="sequence-action"]').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { id: e.getAttribute('data-testid'), mid: r.top + r.height / 2, top: r.top, bottom: r.bottom, height: r.height }
      }),
    )
  const wide = await rows()
  expect(wide.length).toBe(6) // step 0, four branches, and Next up (or All concepts known)
  for (const r of wide) {
    expect(Math.abs(r.mid - wide[0].mid)).toBeLessThan(1)
    expect(r.height).toBe(34)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(strip.getByTestId('sequence-scroll')).toHaveAttribute('data-fade-right', 'true')
  const narrow = await rows()
  const steps = narrow.filter((r) => r.id !== 'sequence-action')
  const next = narrow.find((r) => r.id === 'sequence-action')!
  for (const r of steps) expect(Math.abs(r.mid - steps[0].mid)).toBeLessThan(1)
  expect(next.top).toBeGreaterThan(Math.max(...steps.map((r) => r.bottom)))
  // The steps scroll sideways instead of wrapping.
  const scroll = await strip.getByTestId('sequence-scroll').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(scroll.sw).toBeGreaterThan(scroll.cw)
  await expect(strip.getByTestId('sequence-scroll')).toHaveAttribute('data-fade-right', 'true')
})

test('Home fits a 390px screen when a paper has a long title', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  // A fixed id costs a slot only the first time; after that it is cached.
  await openReadyFixturePaper(page, LONG_ID)
  await page.setViewportSize({ width: 390, height: 844 })
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth)

  await page.goto('/home')
  const recent = page.getByTestId('recently-analyzed')
  await expect(recent.locator('li').first()).toBeVisible({ timeout: 15_000 })
  // The list holds the ten papers analyzed last, so in a fresh local state the long title is among them.
  if (await recent.getByText('Deliberately Long Title').count()) {
    const title = recent.locator('li a > span').filter({ hasText: 'Deliberately Long Title' }).first()
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  }
  expect(await pageWidth()).toBeLessThanOrEqual(390)
})

test('recommended sequence: next up follows prerequisites and opens the concept', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // Step 0 comes first; with the overview read, Next up names a concept.
  await setOverviewRead(page, true)
  await resetAll(page)
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Softmax over scores')
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"]')).toHaveAttribute('data-current', 'true')
  await expect(page.locator('[data-testid="branch"][data-branch-key="foundations"] [data-testid="branch-current"]')).toHaveText('Start here')

  await page.getByTestId('next-up').click()
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await expect(card(page, 'c1')).toHaveAttribute('data-next-up', 'true')
  await card(page, 'c1').getByTestId('status-known').click()
  await page.keyboard.press('Escape')
  // Gradient descent is the other tier-0 concept in foundations.
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Gradient descent')
  await page.getByTestId('next-up').click()
  await expect(card(page, 'c5')).toHaveAttribute('data-next-up', 'true')
  await card(page, 'c5').getByTestId('status-known').click()
  await page.keyboard.press('Escape')
  // c2 depends on c1, which is now known, so it is next.
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Attention as a weighted average')
  await expect(page.locator('[data-testid="sequence-step"][data-state="done"]')).toContainText('Foundations')
  await expect(page.locator('[data-testid="branch"][data-branch-key="attention"] [data-testid="branch-current"]')).toHaveText('Continue')
})

test('known or not known, saved per reader with a green outline; the paper is shared', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  await openReadyFixturePaper(ada.page)
  await openBranch(ada.page, 'foundations')
  const c1 = card(ada.page, 'c1')
  const conceptId = (await c1.getAttribute('data-concept-id'))!
  await resetStatus(ada.page, 'c1')
  await resetStatus(ada.page, 'c5')
  const progress = branchKnown(ada.page, 'foundations')
  await expect(progress).toHaveAttribute('data-known', '0')

  await expect(c1.getByTestId('status-learning')).toHaveCount(0)
  await expect(c1.getByTestId('status-known')).toHaveAttribute('aria-checked', 'false')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(c1.getByTestId('status-known')).toHaveAttribute('aria-checked', 'true')
  await expect(c1).toHaveClass(/known-outline/)
  await expect(progress).toHaveAttribute('data-known', '1')

  await ada.page.reload()
  await openBranch(ada.page, 'foundations')
  await expect(card(ada.page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })

  // The knowledge page lists the checked concept under its paper.
  await ada.page.goto('/knowledge')
  const row = ada.page.locator(`[data-testid="checked-concept"][data-concept-id="${conceptId}"]`)
  await expect(row).toContainText('Softmax over scores')
  await expect(ada.page.getByTestId('checked-paper').filter({ has: row })).toContainText(FIXTURE_TITLE)
  await ada.page.getByTestId('checked-search').fill('softmax')
  await expect(row).toBeVisible()
  await ada.page.getByTestId('checked-search').fill('no such concept')
  await expect(row).toHaveCount(0)

  await calm(bob.page)
  await bob.page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(bob.page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await openBranch(bob.page, 'foundations')
  await expect(card(bob.page, 'c1')).toHaveAttribute('data-status', 'unknown')
  await bob.page.goto('/knowledge')
  await expect(bob.page.getByTestId('knowledge-page')).toBeVisible()
  await expect(bob.page.locator(`[data-testid="checked-concept"][data-concept-id="${conceptId}"]`)).toHaveCount(0)
})

test('quick repeated status clicks leave one knowledge row and no write error', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  await openBranch(page, 'foundations')
  const conceptId = (await card(page, 'c1').getAttribute('data-concept-id'))!
  await resetStatus(page, 'c1')
  // Three clicks inside one round trip: before, the second one created a duplicate row.
  await card(page, 'c1').getByTestId('status-known').evaluate((el: HTMLElement) => {
    el.click()
    el.click()
    el.click()
  })
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })
  await expect(card(page, 'c1').getByTestId('status-known')).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByText(/duplicate|unique/i)).toHaveCount(0)
  await page.goto('/knowledge')
  await expect(page.locator(`[data-testid="checked-concept"][data-concept-id="${conceptId}"]`)).toHaveCount(1, { timeout: 15_000 })
})

test('Explain with AI is cached on the concept', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  await openBranch(page, 'attention')
  const c2 = card(page, 'c2')

  const explain = c2.getByTestId('explain-button')
  if (await explain.isVisible()) {
    await explain.click() // a fresh explanation opens on its own
  } else {
    await c2.getByTestId('explain-toggle').click() // a cached one starts collapsed
  }
  await expect(c2.getByTestId('concept-explanation')).toContainText('Worked example', { timeout: 15_000 })
})

test('AI explanations render their math with KaTeX and leave prices as text', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // Explanations cached by older runs have no math, so look for the first one that does.
  let found = false
  for (const branch of ['foundations', 'geometry', 'other', 'attention']) {
    if (found) break
    await openBranch(page, branch)
    for (const c of await page.getByTestId('branch-concepts').getByTestId('concept-card').all()) {
      if (await c.getByTestId('explain-button').count()) await c.getByTestId('explain-button').click()
      else if (await c.getByTestId('explain-toggle').count()) await c.getByTestId('explain-toggle').click()
      else continue
      const explanation = c.getByTestId('concept-explanation')
      await expect(explanation).toBeVisible({ timeout: 15_000 })
      if (!/sigma|σ/.test((await explanation.textContent()) ?? '')) continue
      await expect(explanation.locator('.katex').first()).toBeVisible({ timeout: 15_000 })
      await expect(explanation.locator('.katex-display')).toHaveCount(1)
      await expect(explanation).toContainText('a $5 price stays text')
      found = true
      break
    }
  }
  expect(found).toBe(true)
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

test('checking a concept in one paper leaves another paper unchecked and shows a hint there', async ({ users }) => {
  test.setTimeout(200_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  // Paper A: c1 checked.
  await openReadyFixturePaper(page)
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await page.keyboard.press('Escape')

  // Paper B, analyzed from the same fixture: its c1 starts unchecked and points to A.
  await openReadyFixturePaper(page, SECOND_ID)
  await openBranch(page, 'foundations')
  await resetStatus(page, 'c1')
  const b1 = card(page, 'c1')
  await expect(b1).toHaveAttribute('data-status', 'unknown')
  await expect(b1).not.toHaveClass(/known-outline/)
  const hint = b1.getByTestId('concept-hint')
  await expect(hint).toHaveAttribute('data-hint', 'checked')
  await expect(hint).toContainText(`You checked this in ${FIXTURE_TITLE}`)
  await expect(hint.getByRole('link')).toHaveAttribute('href', /\/p\/0000~\d{5}$/)
  // B's progress counts only B's checkmarks.
  await expect(branchKnown(page, 'foundations')).toHaveAttribute('data-known', '0')
  await page.keyboard.press('Escape')

  // The overview chip carries the same note.
  await page.getByTestId('open-overview').click()
  const win = page.getByTestId('overview-window')
  await expect(win).toBeVisible()
  await expect(win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-concept-key="c1"] [data-testid="overview-chip-hint"]').first()).toContainText('You checked this in')
  await page.keyboard.press('Escape')

  // Ticking it in B hides the note; A still has its own checkmark.
  await openBranch(page, 'foundations')
  await card(page, 'c1').getByTestId('status-known').click()
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'known')
  await expect(card(page, 'c1').getByTestId('concept-hint')).toHaveCount(0)
  await resetStatus(page, 'c1')
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })
  await expect(card(page, 'c1').getByTestId('concept-hint')).toHaveCount(0)
})

test('a profile topic shows "In your profile" on its concept and checks nothing', async ({ users }) => {
  test.setTimeout(150_000)
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await calm(page)
  const removeFromProfile = async () => {
    await page.goto('/knowledge')
    const item = page.locator('[data-testid="knowledge-item"][data-topic-key="gradient-descent"]')
    await expect(page.getByTestId('knowledge-page')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
    if (await item.count()) {
      await item.getByTestId('status-known').click()
      await expect(item).toHaveCount(0, { timeout: 15_000 })
    }
  }
  await removeFromProfile()

  // Add "Gradient descent" to the profile by search.
  await page.getByTestId('topic-search').fill('Gradient descent')
  const match = page.locator('[data-testid="topic-match"][data-topic-key="gradient-descent"]')
  await match.getByTestId('status-known').click()
  await expect(page.locator('[data-testid="knowledge-item"][data-topic-key="gradient-descent"]')).toBeVisible({ timeout: 15_000 })

  // c5 uses that topic: it shows the note but stays unchecked.
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await openBranch(page, 'foundations')
  const c5 = card(page, 'c5')
  await expect(c5).toHaveAttribute('data-status', 'unknown')
  await expect(c5.getByTestId('concept-hint')).toHaveAttribute('data-hint', 'profile')
  await expect(c5.getByTestId('concept-hint')).toHaveText('In your profile')
  await expect(card(page, 'c1').getByTestId('concept-hint')).toHaveCount(0)
  await expect(branchKnown(page, 'foundations')).toHaveAttribute('data-known', '0')

  await removeFromProfile()
})

test('first-run prompt shows for an empty knowledge profile and can be dismissed', async ({ users }) => {
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await page.goto('/home')
  await page.evaluate(() => localStorage.removeItem('schema:first-run-dismissed'))
  await page.reload()
  await expect(page.getByTestId('home-page')).toBeVisible()
  // Bob never checks a concept in these specs, and the profile spec removes the topic it adds, so he has no rows.
  await expect(page.getByTestId('first-run')).toContainText('Tell Schema what you already know')
  await page.getByTestId('first-run-dismiss').click()
  await expect(page.getByTestId('first-run')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByTestId('first-run')).toHaveCount(0)
})

test('finishing a paper can check its remaining concepts; Read again reopens it', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('read-again').isVisible()) await page.getByTestId('read-again').click()
  await page.getByTestId('finish-toggle').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await setOverviewRead(page, true)
  await expect(page.getByTestId('sequence-done')).toContainText('All concepts known')
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toHaveAttribute('data-status', 'known')
  await page.keyboard.press('Escape')

  await page.goto('/library')
  await page.getByRole('button', { name: 'Finished', exact: true }).click()
  const row = page.locator('[data-testid="library-row"][data-status="finished"]').filter({ hasText: `arXiv ${FIXTURE_ID}` })
  await expect(row).toBeVisible()
  await row.getByTestId('library-read-again').click()
  await page.getByRole('button', { name: 'In progress', exact: true }).click()
  await expect(page.locator('[data-testid="library-row"][data-status="reading"]').filter({ hasText: `arXiv ${FIXTURE_ID}` })).toBeVisible()
})

/**
 * A fixture id nobody has analyzed yet (checked with peekPaper), ending in
 * `suffix`; '' gives a normal paper (not ending in 77 or 99).
 */
async function newFixtureId(page: Page, suffix: '' | '77' | '99'): Promise<string> {
  for (let tries = 0; tries < 30; tries++) {
    const n = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
    const tail = suffix || String(10 + Math.floor(Math.random() * 90))
    if (!suffix && (tail === '77' || tail === '99')) continue
    const id = `0000.${n}${tail}`
    const peek = await page.evaluate(async (input) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then((r) => r.json())
      const res = await fetch('/api/actions/peekPaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify({ input }),
      })
      return res.json()
    }, id)
    if (peek.success && peek.data.status === 'new') return id
  }
  throw new Error('No unused fixture id found')
}

async function allowanceLeft(page: Page): Promise<number> {
  await page.goto('/home')
  const allowance = page.getByTestId('sidebar-allowance')
  await expect(allowance).toHaveAttribute('data-remaining', /\d+/, { timeout: 15_000 })
  return Number(await allowance.getAttribute('data-remaining'))
}

async function analyzeUntilFailed(page: Page, id: string, message: string) {
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: READY_TIMEOUT })
  await expect(page.getByTestId('paper-failed')).toContainText(message)
}

test('a failure before anything is billed gives the slot back; after conversion it keeps it; anyone can retry', async ({ users }) => {
  test.setTimeout(200_000)
  // The other specs leave Bob and Dana at their daily caps, so Cara and Ada share the roles:
  // whoever has more room requests, the other retries.
  const [first, second] = await users(['Schema cara', 'Schema ada'])
  await calm(first.page)
  await calm(second.page)
  const left = [await allowanceLeft(first.page), await allowanceLeft(second.page)]
  const [requester, retrier] = left[0] >= left[1] ? [first, second] : [second, first]
  const before = Math.max(left[0], left[1])
  test.skip(before < 2, 'Cara and Ada are near the daily cap in this local state')

  // The conversion itself fails: nothing was billed, so the slot comes back.
  await analyzeUntilFailed(requester.page, await newFixtureId(requester.page, '77'), 'Fixture conversion failure')
  expect(await allowanceLeft(requester.page)).toBe(before)

  // A scanned PDF fails after the paid conversion: the slot stays used.
  const scanned = await newFixtureId(requester.page, '99')
  await analyzeUntilFailed(requester.page, scanned, 'almost no extractable text')
  expect(await allowanceLeft(requester.page)).toBe(before - 1)

  // Another reader can retry it; the retry uses the retrier's slot.
  const retrierBefore = await allowanceLeft(retrier.page)
  test.skip(retrierBefore === 0, 'The retrier is at the daily cap in this local state')
  await retrier.page.goto(`/p/${scanned.replace('.', '~')}`)
  await expect(retrier.page.getByTestId('paper-failed')).toContainText('Anyone signed in can retry')
  await retrier.page.getByTestId('paper-failed').getByRole('button', { name: 'Retry' }).click()
  await expect(retrier.page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', /queued|processing/, { timeout: 15_000 })
  await expect(retrier.page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: READY_TIMEOUT })
  expect(await allowanceLeft(retrier.page)).toBe(retrierBefore - 1)
})

test('the daily cap refuses a sixth new paper', async ({ users }) => {
  test.setTimeout(150_000)
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  let refused = ''
  for (let i = 0; i < 6 && !refused; i++) {
    await page.goto('/home')
    const id = await newFixtureId(page, '')
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
  // Demo mode keeps the overview's read mark in this browser.
  await setOverviewRead(page, true)
  await page.reload()
  expect(await overviewState(page)).toBe('read')
  await openBranch(page, 'foundations')
  const c1 = card(page, 'c1')
  await expect(c1).toHaveAttribute('data-status', 'unknown')
  await c1.getByTestId('status-known').click()
  await expect(c1).toHaveAttribute('data-status', 'known')
  await expect(branchKnown(page, 'foundations')).toHaveAttribute('data-known', '1')
  // The sequence uses the local demo state too.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('next-up')).toHaveText('Next up: Gradient descent')
  // Demo mode has no hints.
  await openBranch(page, 'foundations')
  await expect(page.getByTestId('concept-hint')).toHaveCount(0)
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

test('a long workspace list scrolls inside the sidebar and leaves Recent papers and the footer in view', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/home')
  const list = page.getByTestId('sidebar-workspaces')
  await expect(list).toBeVisible()
  // Thirty rows stand in for a reader with many workspaces; only the layout is measured.
  await list.evaluate((ul) => {
    const row = ul.querySelector('li') ?? Object.assign(document.createElement('li'), { textContent: 'Workspace' })
    for (let i = 0; i < 30; i++) ul.appendChild(row.cloneNode(true))
  })
  const box = async (testId: string) => (await page.getByTestId(testId).boundingBox())!
  const ws = await box('sidebar-workspaces')
  const recent = await page.getByRole('navigation', { name: 'Recent papers' }).boundingBox()
  const footer = await box('sidebar-knowledge')
  expect(await list.evaluate((ul) => ul.scrollHeight > ul.clientHeight)).toBe(true)
  expect(ws.y + ws.height).toBeLessThanOrEqual(recent!.y + 1)
  expect(footer.y + footer.height).toBeLessThanOrEqual(720)
  await expect(page.getByTestId('sidebar-allowance')).toBeInViewport()
})
