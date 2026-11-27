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
import type { Locator, Page } from '@playwright/test'

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
/** Fixture ids ending in 33 get five branches with names longer than the step strip's cut (fixtures.ts). */
const FIVE_ID = '0000.00033'
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
  }, [FIXTURE_ID, SECOND_ID, LONG_ID, FIVE_ID])
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

/**
 * Home's paper box: a paper that exists opens at once; a new one opens the Add
 * window with its look-up done, and goes into a new fixture workspace.
 */
async function openFromHome(page: Page, id: string) {
  await page.getByTestId('analyze-input').fill(id)
  await page.getByTestId('analyze-submit').click()
  const dialog = page.getByTestId('add-dialog')
  await expect(page.getByTestId('paper-page').or(dialog)).toBeVisible({ timeout: 15_000 })
  if (await dialog.isVisible()) {
    await expect(dialog.getByTestId('add-paper-title')).toBeVisible()
    await dialog.getByTestId('dest-new').check()
    await dialog.getByTestId('dest-name').fill(`[fixture] From Home ${Date.now()}`)
    await dialog.getByTestId('add-paper-submit').click()
  }
  await expect(page).toHaveURL(new RegExp(`/p/${id.replace('.', '~')}$`), { timeout: 15_000 })
}

/** Read again; when finishing checked concepts, it asks first, and this keeps them. */
async function readAgain(page: Page, testId: 'read-again' | 'library-read-again', row = page.locator('body')) {
  await row.getByTestId(testId).click()
  const confirm = page.getByTestId('read-again-confirm')
  const reopened = testId === 'read-again' ? page.getByTestId('finish-toggle') : row.locator(`[data-testid="library-finish"]`)
  await expect(confirm.or(reopened)).toBeVisible({ timeout: 15_000 })
  if (await confirm.isVisible()) await confirm.click()
}

async function openReadyFixturePaper(page: Page, id = FIXTURE_ID) {
  await calm(page)
  await page.goto('/home')
  await openFromHome(page, id)
  const paperPage = page.getByTestId('paper-page')
  await expect(paperPage).toHaveAttribute('data-paper-status', /ready|failed/, { timeout: READY_TIMEOUT })
  if ((await paperPage.getAttribute('data-paper-status')) === 'failed') {
    await page.getByTestId('paper-failed').getByRole('button', { name: 'Retry' }).click()
  }
  await expect(paperPage).toHaveAttribute('data-paper-status', 'ready', { timeout: READY_TIMEOUT })
}

/** Cards of a FloatingGraph that leave its canvas, or cover its center card (by index). */
async function graphFits(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((graph) => {
    const box = graph.getBoundingClientRect()
    const centerBox = graph.querySelector(':scope > div.origin-top-left:not(.graph-node) > *')!.getBoundingClientRect()
    const outside: number[] = []
    const onCenter: number[] = []
    graph.querySelectorAll('.graph-node > *').forEach((node, i) => {
      const r = node.getBoundingClientRect()
      if (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1) outside.push(i)
      if (r.left < centerBox.right && centerBox.left < r.right && r.top < centerBox.bottom && centerBox.top < r.bottom) onCenter.push(i)
    })
    return { outside, onCenter }
  })
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
  // Walkthrough summaries render their LaTeX with KaTeX, like concept text.
  await expect(page.getByTestId('walkthrough').locator('li').filter({ hasText: '3 Method' }).locator('.katex').first()).toBeAttached({ timeout: 10_000 })
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
  await expect(panel).toHaveCount(0)
  await expect(win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-concept-key="c3"]')).toHaveAttribute('data-hot', 'true')
  await expect(win.locator('[data-testid="overview-step"][data-item-id="s4"]')).toHaveAttribute('data-hot', 'true')
  // Closing it goes back to the card: the branch reopens there, outlined, with focus on See in overview.
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(card(page, 'c3')).toBeInViewport()
  await expect(card(page, 'c3').getByTestId('land-ring')).toBeAttached()
  await expect(card(page, 'c3').getByTestId('see-in-overview')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-testid="branch"][data-branch-key="geometry"]')).toBeFocused()
})

test('See in overview keeps the requested highlight while the pointer stays still, and hover takes over once it moves', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyFixturePaper(page)
  const win = page.getByTestId('overview-window')
  const hotChips = () => win.locator('[data-testid="overview-chip"][data-hot="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-concept-key')))
  const hotSteps = () => win.locator('[data-testid="overview-step"][data-hot="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')))
  // c5 (Gradient descent) is in "Also needed"; the window opens with story chips and sentences under the still pointer.
  await openBranch(page, 'foundations')
  await card(page, 'c5').getByTestId('see-in-overview').click()
  await expect(win).toBeVisible()
  // The chip scrolls into view after the window enters, which sends pointer-enter to whatever lands under the pointer.
  await page.waitForTimeout(900)
  expect(await hotChips()).toEqual(['c5'])
  expect(await hotSteps()).toEqual([])
  // A real move hands the highlight to whatever the pointer is over.
  await win.locator('[data-testid="overview-step"][data-item-id="s1"]').hover()
  await expect.poll(hotSteps).toEqual(['s1'])
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('A plain role that restates why-needed is hidden, and See in overview moves to the why-needed line', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  const win = page.getByTestId('overview-window')
  // c6's role ("These are the scores the correction is added to.") repeats its why-needed line.
  await openBranch(page, 'attention')
  const c6 = card(page, 'c6')
  await expect(c6.getByTestId('concept-role')).toHaveCount(0)
  await expect(c6).toContainText('The correction is added to scores scaled by')
  await c6.getByTestId('see-in-overview').click()
  await expect(win).toBeVisible()
  await expect(win.locator('[data-testid="overview-map"] [data-testid="overview-chip"][data-concept-key="c6"]')).toHaveAttribute('data-hot', 'true')
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
  await expect(c6.getByTestId('see-in-overview')).toBeFocused()
})

test('Start in the overview counts as reading it, and the box can still be unticked', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // An unchecked tier-0 concept, so the overview has a concept to start with.
  await openBranch(page, 'foundations')
  await resetStatus(page, 'c1')
  await page.keyboard.press('Escape')
  await setOverviewRead(page, false)

  await page.getByTestId('sequence-overview').click()
  const win = page.getByTestId('overview-window')
  await expect(win).toBeVisible()
  await expect(page.getByTestId('overview-read')).not.toBeChecked()
  const start = win.getByTestId('overview-start')
  await expect(start).toHaveText(/^Start: /)
  const name = ((await start.textContent()) ?? '').replace(/^Start: /, '')
  await start.click()
  await expect(win).toHaveCount(0)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-overview', 'read')
  await expect(page.getByTestId('sequence-overview')).toHaveAttribute('data-state', 'done')
  // It opened the branch at the concept it named.
  await expect(page.locator('[data-testid="branch-panel"] [data-testid="concept-card"][data-next-up="true"]')).toContainText(name)
  await page.keyboard.press('Escape')

  // The mark is saved like the checkbox's, and the box can be unticked.
  await page.reload()
  expect(await overviewState(page)).toBe('read')
  await page.getByTestId('sequence-overview').click()
  await expect(page.getByTestId('overview-read')).toBeChecked()
  await page.getByTestId('overview-read').click()
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-overview', 'unread')
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
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

test('step labels are cut near 24 characters, and all five steps of a five-branch paper fit at 1440', async ({ users, browser }) => {
  test.setTimeout(150_000)
  // Bob analyzes it: Ada's and Cara's new papers a day go to the other specs, and the daily-cap spec uses up Bob's.
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  await bob.page.setViewportSize({ width: 1440, height: 900 })
  await openReadyFixturePaper(bob.page, FIVE_ID)
  await overviewState(bob.page)
  const labelsOf = async (strip: ReturnType<Page['getByTestId']>) => {
    await expect(strip.getByTestId('sequence-step')).toHaveCount(5)
    for (const l of await strip.getByTestId('step-label').allTextContents()) expect(l.length).toBeLessThanOrEqual(24)
    // A cut name keeps its full name as its tooltip and accessible name.
    const first = strip.locator('[data-testid="sequence-step"][data-branch-key="foundations"]')
    await expect(first.getByTestId('step-label')).toHaveText('Mathematical…')
    await expect(first).toHaveAttribute('title', 'Mathematical and machine learning foundations')
    await expect(strip.getByRole('button', { name: /^Step 1: Mathematical and machine learning foundations/ })).toBeVisible()
  }
  await labelsOf(bob.page.getByTestId('sequence-strip'))

  // On the full-width page (the demo, with no sidebar) nothing hides behind the edge: no scroll, no fade.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.addInitScript((id) => localStorage.setItem(`schema:overview-shown:${id}`, '1'), FIVE_ID)
  await page.goto(`/p/${FIVE_ID.replace('.', '~')}`)
  const strip = page.getByTestId('sequence-strip')
  await expect(strip).toBeVisible({ timeout: 20_000 })
  await labelsOf(strip)
  const scroll = strip.getByTestId('sequence-scroll')
  await page.evaluate(() => document.fonts.ready)
  expect(await scroll.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0)
  await expect(scroll).not.toHaveAttribute('data-fade-right', 'true')
  for (const step of await strip.locator('[data-testid="sequence-overview"], [data-testid="sequence-step"]').all()) await expect(step).toBeInViewport({ ratio: 1 })
  await ctx.close()
})

test('Home and a paper page fit a 390px screen when a paper has a long title', async ({ users }) => {
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
  // The paper box's placeholder fits its box at this width.
  const input = page.getByTestId('analyze-input')
  expect(
    await input.evaluate((el: HTMLInputElement) => {
      const cs = getComputedStyle(el)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      return ctx.measureText(el.placeholder).width <= el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    }),
  ).toBe(true)

  // The step strip scrolls inside itself; its screen-reader labels must not widen the page.
  await page.goto(`/p/${LONG_SLUG}`)
  await expect(page.getByTestId('sequence-strip')).toBeVisible({ timeout: 20_000 })
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

test('a Learn first chip leaves one way back, and the card a jump lands on is outlined for a moment', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  const panel = page.getByTestId('branch-panel')
  const title = page.locator('#branch-panel-title')
  const back = page.getByTestId('panel-back')
  await openBranch(page, 'geometry')
  await expect(back).toHaveCount(0)

  // c3 needs c2, which is in Attention.
  await card(page, 'c3').getByTestId('learn-first-chip').filter({ hasText: 'Attention as a weighted average' }).click()
  await expect(title).toHaveText('Attention')
  await expect(card(page, 'c2')).toBeInViewport()
  // The card it lands on is outlined; under reduced motion the outline holds still and fades, then goes.
  const ring = card(page, 'c2').getByTestId('land-ring')
  await expect(ring).toBeAttached()
  expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('land-fade')
  await expect(ring).toHaveCount(0, { timeout: 3000 })
  await expect(back).toHaveText('← Back to Second fundamental form of an embedding manifold')

  // One level only: a second jump replaces the way back with the card just left.
  await card(page, 'c2').getByTestId('learn-first-chip').filter({ hasText: 'Softmax over scores' }).click()
  await expect(title).toHaveText('Foundations')
  await expect(back).toHaveText('← Back to Attention as a weighted average')
  // The way back has the header's width, so a short title does not cut it.
  expect(await back.locator('span').first().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await back.click()
  await expect(title).toHaveText('Attention')
  await expect(card(page, 'c2')).toBeInViewport()
  await expect(card(page, 'c2').getByTestId('land-ring')).toBeAttached()
  // Focus is back on the chip that started the jump, and there is no further back.
  await expect(card(page, 'c2').getByTestId('learn-first-chip').filter({ hasText: 'Softmax over scores' })).toBeFocused()
  await expect(back).toHaveCount(0)

  // With motion allowed the outline also draws in.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await card(page, 'c2').getByTestId('learn-first-chip').first().click()
  await expect(title).toHaveText('Foundations')
  await expect(card(page, 'c1').getByTestId('land-ring')).toBeAttached()
  expect(await card(page, 'c1').getByTestId('land-ring').evaluate((el) => getComputedStyle(el).animationName)).toBe('land-settle')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(back).toHaveCount(0)
})

test('concept cards drop a topic line that repeats the name, explain their depth, and show the explanation allowance once', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  await openBranch(page, 'foundations')
  // c1's topic has another name, so its line stays; c5's topic is "Gradient descent", the concept's own name.
  await expect(card(page, 'c1').getByTestId('concept-topic')).toHaveText('Topic: Softmax function. Turning a vector of scores into a probability distribution.')
  await expect(card(page, 'c5').getByTestId('concept-topic')).toHaveCount(0)
  // The depth label's tooltip says what the level asks of the reader.
  await expect(card(page, 'c1').getByTestId('concept-depth')).toHaveAttribute('title', 'Working: You need it to follow the equations or arguments that use it.')
  await expect(card(page, 'c5').getByTestId('concept-depth')).toHaveAttribute('title', 'Skim: Recognizing the term is enough.')

  // No spec explains a geometry concept, so the allowance shows, once, in the panel header.
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3').getByTestId('concept-depth')).toHaveAttribute('title', "Deep: It is central to the paper's contribution.")
  await expect(page.getByTestId('explain-allowance')).toHaveText(/^\d+ AI explanations left today$/)
  await expect(page.getByTestId('branch-concepts')).not.toContainText('left today')
  await expect(card(page, 'c3').getByTestId('explain-button')).toHaveText('Explain with AI')
  await page.keyboard.press('Escape')
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

  // Walkthrough chips show the same outline for a known concept, with a check so color is not the only cue.
  await ada.page.keyboard.press('Escape')
  await ada.page.getByTestId('view-walkthrough').click()
  const knownChip = ada.page.getByTestId('walkthrough-chip').filter({ hasText: 'Softmax over scores' }).first()
  await expect(knownChip).toHaveAttribute('data-status', 'known')
  await expect(knownChip).toHaveClass(/known-outline/)
  await expect(knownChip).toHaveAccessibleName(/known/)
  // Gradient descent (reset above) is not in a walkthrough section, so take any chip left unchecked.
  const otherChip = ada.page.locator('[data-testid="walkthrough-chip"][data-status="unknown"]').first()
  await expect(otherChip).toBeVisible()
  await expect(otherChip).not.toHaveClass(/known-outline/)
  await expect(otherChip).not.toHaveAccessibleName(/, known/)
  await ada.page.getByTestId('view-branches').click()

  // The knowledge page lists the checked concept under its paper.
  await ada.page.goto('/knowledge')
  const row = ada.page.locator(`[data-testid="checked-concept"][data-concept-id="${conceptId}"]`)
  await expect(row).toContainText('Softmax over scores')
  // The source line reads just that: no stray "0" from the row's stale flag.
  await expect(row.locator('p').nth(1)).toHaveText('Checked by you')
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
  // The second one has a long reason, and the graph still keeps its card inside the canvas and clear of the center card.
  await expect.poll(() => graphFits(page, 'workspace-graph'), { timeout: 10_000 }).toEqual({ outside: [], onCenter: [] })
  await expect(page.getByTestId('workspace-continue')).toContainText('Add one of the recommended papers below, or paste a link.')
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

  if (await page.getByTestId('read-again').isVisible()) await readAgain(page, 'read-again')
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

  // A paper nobody analyzed gives the same time estimate as Home, the landing and the progress view
  // (or, once the reader is at the daily cap in this local state, says the limit is reached).
  await page.getByTestId('add-paper-input').fill(await newFixtureId(page, ''))
  await page.getByTestId('add-paper-lookup').click()
  const left = (await action(page, 'myAllowance', {})).data.analyze.remaining
  await expect(page.getByTestId('add-paper-status')).toContainText(left > 0 ? 'analysis takes 1 to 2 minutes' : "You've reached today's limit")
  await expect(page.getByTestId('home-page')).toContainText('A paper nobody has analyzed takes 1 to 2 minutes')

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

test("Home's paper box opens an analyzed paper at once and sends a new one through the Add window", async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // Analyzed already: it opens directly and uses no slot.
  const before = await allowanceLeft(page)
  await page.getByTestId('analyze-input').fill(FIXTURE_ID)
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  await expect(page.getByTestId('add-dialog')).toHaveCount(0)
  expect(await allowanceLeft(page)).toBe(before)

  // New: the Add window opens on its paper path with the link filled in and the look-up done.
  const id = await newFixtureId(page, '')
  const link = `https://arxiv.org/abs/${id}`
  await page.getByTestId('analyze-input').fill(link)
  await page.getByTestId('analyze-submit').click()
  const dialog = page.getByTestId('add-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('add-paper-input')).toHaveValue(link)
  await expect(dialog.getByTestId('add-paper-title')).toContainText(FIXTURE_TITLE)
  await expect(dialog.getByTestId('add-paper-status')).toContainText(before > 0 ? 'analysis takes 1 to 2 minutes' : "You've reached today's limit")
  await expect(dialog.getByTestId('dest-existing').or(dialog.getByTestId('dest-new')).first()).toBeChecked()
  await expect(dialog.getByTestId('dest-none')).toHaveCount(0)
  // Closing it spends nothing, and focus goes back to the box's button.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('analyze-submit')).toBeFocused()
  expect((await action(page, 'peekPaper', { input: id })).data.status).toBe('new')
  expect(await allowanceLeft(page)).toBe(before)
})

test("Home's paper box finds analyzed papers by name, opens a pick from the keyboard, and still takes a link", async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  const before = await allowanceLeft(page)
  const input = page.getByTestId('analyze-input')
  await expect(input).toHaveAttribute('role', 'combobox')
  // The box controls the listbox, which stays in the page while it is hidden.
  const list = page.locator(`[id="${await input.getAttribute('aria-controls')}"]`)
  await expect(list).toHaveAttribute('role', 'listbox')
  await expect(list).toHaveAttribute('aria-label', 'Analyzed papers')
  const options = list.getByRole('option')

  // One character is not a search yet.
  await input.fill('c')
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('paper-search')).toBeHidden()

  // Every word must match somewhere: a title word and part of the arXiv id leave only that paper.
  await input.fill('curvature 00001')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(options).toHaveCount(1, { timeout: 15_000 })
  const only = options.first()
  await expect(only).toHaveAttribute('data-arxiv', FIXTURE_ID)
  await expect(only).toContainText(FIXTURE_TITLE)
  await expect(only).toContainText(`Author et al. · ${FIXTURE_ID}`)
  await expect(only).toContainText('Free')
  expect((await only.boundingBox())!.height).toBeGreaterThanOrEqual(24)
  // Down highlights it, and Enter opens it as if its id had been submitted: no slot used.
  await input.press('ArrowDown')
  await expect(only).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', (await only.getAttribute('id'))!)
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  expect(await allowanceLeft(page)).toBe(before)

  // Title words in any case list analyzed papers, each marked Free; Up from the top wraps to the last.
  await input.fill('ATTENTION curvature')
  await expect(options.first()).toBeVisible({ timeout: 15_000 })
  const count = await options.count()
  expect(count).toBeLessThanOrEqual(6)
  for (const o of await options.all()) await expect(o).toContainText('Free')
  await input.press('ArrowDown')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await input.press('ArrowUp')
  await expect(input).toHaveAttribute('aria-activedescendant', (await options.last().getAttribute('id'))!)
  await input.press('ArrowDown')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  // Esc closes the list and keeps the text; Down opens it again.
  await input.press('Escape')
  await expect(list).toBeHidden()
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(input).not.toHaveAttribute('aria-activedescendant')
  await expect(input).toHaveValue('ATTENTION curvature')
  await input.press('ArrowDown')
  await expect(list).toBeVisible()
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  // A click outside closes it too.
  await page.getByText('Open a paper', { exact: true }).click()
  await expect(list).toBeHidden()
  await expect(input).toHaveAttribute('aria-expanded', 'false')

  // At 390px the list fits the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await input.fill('curvature attention')
  await expect(options.first()).toBeVisible()
  const box = (await page.getByTestId('paper-search').boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1280, height: 800 })

  // Nothing matches: the list says how to analyze it instead.
  await input.fill('zzqx no such paper')
  await expect(page.getByTestId('paper-search-empty')).toHaveText('No analyzed paper matches. Paste its arXiv link to analyze it.')
  await expect(options).toHaveCount(0)
  // The listbox it controls is hidden, so the box is not expanded.
  await expect(input).toHaveAttribute('aria-expanded', 'false')

  // A link is not a search: no list, and it opens the paper as before.
  await input.fill(`https://arxiv.org/abs/${FIXTURE_ID}`)
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('paper-search')).toBeHidden()
  await page.getByTestId('analyze-submit').click()
  await expect(page).toHaveURL(new RegExp(`/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  expect(await allowanceLeft(page)).toBe(before)
})

test('the Add window preselects the workspace opened last, and an analyzed paper can open without one', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  // Both papers exist; the second is the one to open.
  await openReadyFixturePaper(page, SECOND_ID)
  await openReadyFixturePaper(page)
  // A workspace made now is the one opened last.
  const made = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: `[fixture] Opened last ${Date.now()}` } })
  expect(made.success).toBe(true)
  await page.goto('/home')
  await page.getByTestId('add-open').click()
  const dialog = page.getByTestId('add-dialog')
  await dialog.getByTestId('add-choice-paper').click()
  await dialog.getByTestId('add-paper-input').fill(SECOND_ID)
  await dialog.getByTestId('add-paper-lookup').click()
  await expect(dialog.getByTestId('add-paper-status')).toContainText('Already analyzed')
  await expect(dialog.getByTestId('dest-existing')).toBeChecked()
  await expect(dialog.getByTestId('dest-select')).toHaveValue(made.data.workspaceId)
  await expect(dialog.getByTestId('dest-new')).toBeVisible()

  // Analyzed, so it can open without being filed anywhere.
  await dialog.getByTestId('dest-none').check()
  await expect(dialog.getByTestId('add-paper-submit')).toHaveText('Open paper')
  await dialog.getByTestId('add-paper-submit').click()
  await expect(page).toHaveURL(new RegExp(`^[^#?]*/p/${SECOND_SLUG}$`), { timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe(`/p/${SECOND_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await page.goto(`/w/${made.data.workspaceId}`)
  await expect(page.getByTestId('workspace-paper')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator(`[data-testid="workspace-paper"][data-arxiv="${SECOND_ID}"]`)).toHaveCount(0)

  // A paper already in the preselected workspace says so, and Open is the action.
  await page.goto('/home')
  await page.getByTestId('add-open').click()
  await dialog.getByTestId('add-choice-paper').click()
  await dialog.getByTestId('add-paper-input').fill(FIXTURE_ID)
  await dialog.getByTestId('add-paper-lookup').click()
  await expect(dialog.getByTestId('dest-select')).toHaveValue(made.data.workspaceId)
  const wsName = await dialog.getByTestId('dest-select').locator('option:checked').textContent()
  await expect(dialog.getByTestId('add-paper-already')).toHaveText(`Already in ${wsName}`)
  await expect(dialog.getByTestId('add-paper-submit')).toHaveText('Open paper')
  await dialog.getByTestId('add-paper-submit').click()
  await expect(page).toHaveURL(new RegExp(`/w/${made.data.workspaceId}/p/${FIXTURE_SLUG}$`), { timeout: 15_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
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

test('the first-run link scrolls to the starter topics once they have loaded', async ({ users }) => {
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await calm(page)
  // A short phone screen, so the starter topics sit below the fold.
  await page.setViewportSize({ width: 390, height: 520 })
  await page.goto('/home')
  await page.evaluate(() => localStorage.removeItem('schema:first-run-dismissed'))
  await page.reload()
  await page.getByTestId('first-run').getByRole('link', { name: 'knowledge page' }).click()
  await expect(page).toHaveURL(/\/knowledge#starter$/)
  const starters = page.getByTestId('starter-topics')
  await expect(starters).toBeVisible({ timeout: 15_000 })
  // The section's top lands at the top of the screen, below the 48px header.
  await expect.poll(() => starters.evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 10_000 }).toBeLessThan(100)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect(await starters.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(48)
  // Bob has nothing checked and an empty profile, so the starters come first.
  const order = await page.locator('[data-testid="checked-concepts"], [data-testid="profile"], [data-testid="starter-topics"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual(['starter-topics', 'checked-concepts', 'profile'])
})

test('the sidebar lists Home, Library and Knowledge under Add, and its footer counts concepts learned', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  const pages = page.getByRole('navigation', { name: 'Pages' })
  await expect(pages.getByRole('link')).toHaveText(['Home', 'Library', 'Knowledge'])
  await expect(pages.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  // The group sits right under Add, above the workspaces.
  const add = (await page.getByTestId('add-open').boundingBox())!
  const group = (await pages.boundingBox())!
  const workspaces = (await page.getByRole('navigation', { name: 'Workspaces' }).boundingBox())!
  expect(group.y).toBeGreaterThanOrEqual(add.y + add.height)
  expect(group.y + group.height).toBeLessThanOrEqual(workspaces.y + 1)
  // Library left Recent papers.
  await expect(page.getByRole('navigation', { name: 'Recent papers' }).getByRole('link', { name: 'Library' })).toHaveCount(0)

  await pages.getByRole('link', { name: 'Knowledge' }).click()
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(pages.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('aria-current', 'page')
  await expect(pages.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')
  // The footer stat counts the checked concepts the page lists (stale ones aside), and links there.
  await expect(page.getByTestId('knowledge-page')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  const stat = page.getByTestId('sidebar-knowledge')
  await expect(stat).toHaveText(/^Concepts learned\s*\d+$/)
  const learned = String(await page.locator('[data-testid="checked-concept"]:not([data-stale])').count())
  await expect(stat.locator('b')).toHaveText(learned)
  // The count appears once, in the footer stat, not again on the Knowledge row.
  await expect(page.getByTestId('nav-knowledge-count')).toHaveCount(0)
  await page.goto('/library')
  await stat.click()
  await expect(page).toHaveURL(/\/knowledge$/)

  // The account menu links to Knowledge too.
  await page.goto('/home')
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByTestId('account-knowledge').click()
  await expect(page).toHaveURL(/\/knowledge$/)

  // The phone menu shows the same group.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/library')
  await page.getByRole('button', { name: 'Open menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  const sheetPages = menu.getByRole('navigation', { name: 'Pages' })
  await expect(sheetPages.getByRole('link')).toHaveText(['Home', 'Library', 'Knowledge'])
  // The group heads the sheet: it is the first navigation, right under Add.
  await expect(menu.getByRole('navigation').first()).toHaveAccessibleName('Pages')
  await expect(sheetPages.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  await sheetPages.getByRole('link', { name: 'Knowledge' }).click()
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(menu).toHaveCount(0)
})

test('page headers leave Add and the page name to the sidebar from md up', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.setViewportSize({ width: 1440, height: 900 })
  // Home has no header bar, only one heading for screen readers.
  await page.goto('/home')
  const home = page.getByTestId('home-page')
  await expect(home.locator('[data-testid="continue"], [data-testid="recently-analyzed"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(home.locator('header')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home')
  await expect(page.getByRole('heading', { level: 1 })).toHaveClass(/\bsr-only\b/)
  for (const [path, testId, title] of [
    ['/library', 'library-page', 'Your papers'],
    ['/knowledge', 'knowledge-page', 'What you know'],
  ] as const) {
    await page.goto(path)
    const header = page.getByTestId(testId).locator('header').first()
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(title)
    // No eyebrow label above the title: the highlighted sidebar row names the page.
    await expect(header.locator('.label')).toHaveCount(0)
  }
  // The workspace page and the Add window have no eyebrow either; the workspace page keeps its own Add paper.
  const made = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: `[fixture] Header ${Date.now()}` } })
  expect(made.success).toBe(true)
  await page.goto(`/w/${made.data.workspaceId}`)
  const wsHeader = page.getByTestId('workspace-page').locator('header').first()
  await expect(page.getByTestId('workspace-name')).toBeVisible({ timeout: 15_000 })
  await expect(wsHeader.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(wsHeader.locator('.label')).toHaveCount(0)
  await expect(wsHeader.getByTestId('add-paper-open')).toBeVisible()
  await wsHeader.getByTestId('add-paper-open').click()
  await expect(page.locator('#add-dialog-title')).toHaveText('Add a paper')
  await expect(page.getByTestId('add-dialog').locator('#add-dialog-title').locator('xpath=preceding-sibling::*')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto('/home')
  await page.getByTestId('add-open').click()
  await expect(page.locator('#add-dialog-title')).toHaveText('Add')
  await expect(page.getByTestId('add-dialog').locator('#add-dialog-title').locator('xpath=preceding-sibling::*')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-dialog')).toHaveCount(0)

  // Beside the sidebar there is one Add button, the sidebar's.
  await page.goto('/home')
  await expect(page.getByTestId('add-open')).toBeVisible()
  await expect(page.getByTestId('home-add-open')).toBeHidden()
  await expect(page.getByRole('button', { name: /^Add paper or workspace$/ })).toHaveCount(1)
  // On a phone the sidebar is behind the menu, so Home keeps its own Add at the top of the page, and it opens the Add window.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('home-add-open')).toBeVisible()
  await expect(page.getByTestId('add-open')).toBeHidden()
  const addBox = (await page.getByTestId('home-add-open').boundingBox())!
  for (const section of await page.getByTestId('home-page').locator('section').all()) {
    expect(addBox.y + addBox.height).toBeLessThanOrEqual((await section.boundingBox())!.y)
  }
  await page.getByTestId('home-add-open').click()
  await expect(page.getByTestId('add-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-dialog')).toHaveCount(0)
})

test('the theme toggle sits beside the account row and keeps its choice across a reload', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  await page.evaluate(() => localStorage.removeItem('schema:theme'))
  await page.reload()
  const nav = page.getByTestId('app-navigation')
  const toggle = nav.getByTestId('theme-toggle')
  const account = nav.getByRole('button', { name: 'Account menu' })
  await expect(account).toBeVisible()
  // On the account row, to its right.
  const a = (await account.boundingBox())!
  const t = (await toggle.boundingBox())!
  expect(Math.abs(a.y + a.height / 2 - (t.y + t.height / 2))).toBeLessThan(4)
  expect(t.x).toBeGreaterThanOrEqual(a.x + a.width)
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(await isDark()).toBe(false)
  await toggle.click()
  expect(await isDark()).toBe(true)
  await page.reload()
  await expect(nav.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to light theme')
  expect(await isDark()).toBe(true)
  await nav.getByTestId('theme-toggle').click()
  expect(await isDark()).toBe(false)
  await page.evaluate(() => localStorage.removeItem('schema:theme'))
})

/** WCAG 2 contrast between token colors as the page resolves them, alpha-composited over `on`. */
async function tokenContrast(page: Page, pairs: [fg: string, bg: string][]): Promise<number[]> {
  return page.evaluate((pairs) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const probe = document.createElement('div')
    document.body.appendChild(probe)
    // A CSS color (oklch, color-mix, var()) painted on a canvas over `under`, read back as sRGB.
    const rgb = (css: string, under = '#808080') => {
      probe.style.color = css
      const resolved = getComputedStyle(probe).color
      ctx.globalCompositeOperation = 'copy'
      ctx.fillStyle = under
      ctx.fillRect(0, 0, 1, 1)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = resolved
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return `rgb(${r}, ${g}, ${b})`
    }
    const lum = (c: string) => {
      const [r, g, b] = c.match(/\d+/g)!.map((v) => {
        const x = Number(v) / 255
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const out = pairs.map(([fg, bg]) => {
      const back = rgb(bg)
      const front = rgb(fg, back)
      const [a, b] = [lum(front), lum(back)]
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
    })
    probe.remove()
    return out
  }, pairs)
}

test('text, edge and focus tokens meet 4.5:1 and 3:1 in light and dark, and buttons show the 70% halo', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  await page.goto('/home')
  await expect(page.getByTestId('home-page')).toBeVisible()
  const surfaces = ['var(--color-card)', 'var(--color-surface-2)', 'var(--color-background)']
  const text = ['var(--color-known)', 'var(--color-success)', 'var(--color-learning)', 'var(--color-warning)', 'var(--color-faint)', 'var(--color-muted-foreground)']
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(scheme === 'dark')
    const textRatios = await tokenContrast(page, text.flatMap((t) => surfaces.map((s) => [t, s] as [string, string])))
    for (const r of textRatios) expect(r).toBeGreaterThanOrEqual(4.5)
    // The Finished chip sets green text on a 12% green tint.
    const [chip] = await tokenContrast(page, [['var(--color-known)', 'color-mix(in oklab, var(--color-known) 12%, var(--color-card))']])
    expect(chip).toBeGreaterThanOrEqual(4.5)
    // Form-control and checkbox edges, and the focus halo at 70%.
    const edges = await tokenContrast(page, surfaces.flatMap((s) => [['var(--color-input)', s], ['color-mix(in oklab, var(--color-ring) 70%, transparent)', s]] as [string, string][]))
    for (const r of edges) expect(r).toBeGreaterThanOrEqual(3)
    // Faint stays a visible step lighter than muted.
    const [faintStep] = await tokenContrast(page, [['var(--color-faint)', 'var(--color-muted-foreground)']])
    expect(faintStep).toBeGreaterThan(1.2)
  }
  // A keyboard-focused button draws the ring token at 70%.
  await page.getByTestId('analyze-input').focus()
  await page.keyboard.press('Tab')
  const submit = page.getByTestId('analyze-submit')
  await expect(submit).toBeFocused()
  // The halo eases in over 150ms, so wait for it to settle.
  await expect.poll(() => submit.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/\/ 0\.7\) 0px 0px 0px 3px|, 0\.7\) 0px 0px 0px 3px/)
  // The concept checkbox's unchecked edge is the input token in both themes.
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await openBranch(page, 'foundations')
  const box = card(page, 'c5').getByTestId('status-known')
  if ((await box.getAttribute('aria-checked')) === 'false') {
    const [edge, input] = await box.evaluate((el) => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--color-input)'
      document.body.appendChild(probe)
      const out = [getComputedStyle(el).borderTopColor, getComputedStyle(probe).color]
      probe.remove()
      return out
    })
    expect(edge).toBe(input)
  }
  await page.keyboard.press('Escape')
})

test('Uncheck all on the knowledge page asks first and unchecks only that paper', async ({ users }) => {
  test.setTimeout(200_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  // Paper B keeps a checkmark; paper A gets two.
  await openReadyFixturePaper(page, SECOND_ID)
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await page.keyboard.press('Escape')
  await openReadyFixturePaper(page)
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await ensureKnown(page, 'c5')
  await page.keyboard.press('Escape')

  await page.goto('/knowledge')
  await expect(page.getByTestId('knowledge-page')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  // Ada has checkmarks, so the starters keep their place after the profile.
  const order = await page.locator('[data-testid="checked-concepts"], [data-testid="profile"], [data-testid="starter-topics"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order.slice(0, 2)).toEqual(['checked-concepts', 'profile'])
  const groupA = page.getByTestId('checked-paper').filter({ hasText: `arXiv ${FIXTURE_ID}` })
  const groupB = page.getByTestId('checked-paper').filter({ hasText: `arXiv ${SECOND_ID}` })
  const inA = await groupA.getByTestId('checked-concept').count()
  const inB = await groupB.getByTestId('checked-concept').count()
  expect(inA).toBeGreaterThanOrEqual(2)
  expect(inB).toBeGreaterThanOrEqual(1)

  const confirm = page.getByRole('dialog', { name: `Uncheck ${inA} concepts in ${FIXTURE_TITLE}?` })
  await groupA.getByTestId('uncheck-all').click()
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(groupA.getByTestId('checked-concept')).toHaveCount(inA)

  await groupA.getByTestId('uncheck-all').click()
  await confirm.getByRole('button', { name: 'Uncheck all' }).click()
  await expect(confirm).toHaveCount(0, { timeout: 15_000 })
  await expect(groupA).toHaveCount(0, { timeout: 15_000 })
  await expect(groupB.getByTestId('checked-concept')).toHaveCount(inB)
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'unknown', { timeout: 15_000 })
  await expect(card(page, 'c5')).toHaveAttribute('data-status', 'unknown')
})

test('finishing a paper can check its remaining concepts; Read again reopens it', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('read-again').isVisible()) await readAgain(page, 'read-again')
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
  // Finishing checked the rest, so Read again asks whether to uncheck them, unticked by default.
  await row.getByTestId('library-read-again').click()
  const ask = page.getByRole('dialog', { name: 'Read this paper again?' })
  await expect(ask).toBeVisible()
  await expect(ask.getByRole('checkbox', { name: /^Also uncheck the \d+ concepts? checked when you finished$/ })).not.toBeChecked()
  await ask.getByTestId('read-again-confirm').click()
  await expect(ask).toHaveCount(0)
  await page.getByRole('button', { name: 'In progress', exact: true }).click()
  await expect(page.locator('[data-testid="library-row"][data-status="reading"]').filter({ hasText: `arXiv ${FIXTURE_ID}` })).toBeVisible()

  // Reopened with every concept still checked: Mark finished shows once, beside "All concepts known", in both views.
  await page.goto(`/p/${FIXTURE_SLUG}`)
  const done = page.getByTestId('sequence-done')
  await expect(done).toContainText('All concepts known')
  await expect(done.getByTestId('finish-toggle')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark finished', exact: true })).toHaveCount(1)
  await page.getByTestId('view-walkthrough').click()
  await expect(page.getByTestId('walkthrough')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark finished', exact: true })).toHaveCount(1)
  await expect(done.getByTestId('finish-toggle')).toBeVisible()
})

test('each library filter has its own empty text', async ({ users }) => {
  // Bob only opens papers in these specs and never finishes one.
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await page.goto('/library')
  await expect(page.getByTestId('library-page')).toBeVisible()
  await page.getByRole('button', { name: 'Finished', exact: true }).click()
  await expect(page.getByTestId('library-empty')).toHaveText('No finished papers yet. Papers you mark finished are listed here.')
})

/** The arXiv ids of the library rows in `scope`, top to bottom. */
function libraryIds(scope: Locator): Promise<string[]> {
  return scope.getByTestId('library-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-arxiv') ?? ''))
}

test('the library groups papers by workspace and filters them by topic; both stay in the URL across a reload and Back', async ({ users }) => {
  test.setTimeout(240_000)
  // Bob only opens papers in these specs and never finishes one, so a topic combined with Finished matches nothing.
  const [ada, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  // Ada makes sure the papers exist (free when the earlier specs analyzed them). Only the five-branch fixture
  // (ids ending in 33) has the topic "Accuracy metric (fixture)" (c10 in fiveBranchConcepts).
  for (const id of [FIXTURE_ID, FIVE_ID, LONG_ID]) await openReadyFixturePaper(ada.page, id)
  // Bob opens all three from their own pages. Opening alone puts none of them in his Library, so he saves
  // LONG_ID, which he never files in a workspace. The other two go into workspaces below.
  for (const id of [FIXTURE_ID, FIVE_ID, LONG_ID]) {
    const slug = id.replace('.', '~')
    await page.goto(`/p/${slug}`)
    await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
    await expect(page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toBeVisible({ timeout: 15_000 })
  }
  await saveFromPaperPage(page)
  // Two new workspaces, the second made last so it is the most recently opened: FIXTURE_ID in both, FIVE_ID in the second.
  const stamp = Date.now()
  const nameA = `[fixture] Library A ${stamp}`
  const nameB = `[fixture] Library B ${stamp}`
  const wsA = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: nameA } })
  expect(wsA.success).toBe(true)
  const wsB = await action(page, 'analyzePaper', { input: FIVE_ID, newWorkspace: { name: nameB } })
  expect(wsB.success).toBe(true)
  expect((await action(page, 'analyzePaper', { input: FIXTURE_ID, workspaceId: wsB.data.workspaceId })).success).toBe(true)

  await page.goto('/library')
  const list = page.getByTestId('library-page')
  const rowOf = (id: string, scope: Locator = list) => scope.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)
  const sort = page.getByRole('group', { name: 'Sort papers' })
  const status = page.getByRole('group', { name: 'Filter papers' })
  const topicButton = page.getByRole('button', { name: 'Filter by topic' })
  await expect(rowOf(LONG_ID)).toBeVisible({ timeout: 15_000 })
  await expect(sort.getByRole('button', { name: 'Last opened' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('library-group')).toHaveCount(0)
  const opened = await libraryIds(list)
  expect(opened).toEqual(expect.arrayContaining([FIXTURE_ID, FIVE_ID, LONG_ID]))

  // Workspace: groups in the sidebar's order (newest first), a paper in two workspaces under both, unfiled papers last.
  await sort.getByRole('button', { name: 'Workspace' }).click()
  await expect(page).toHaveURL(/\/library\?sort=workspace$/)
  await expect(sort.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-pressed', 'true')
  const groups = page.getByTestId('library-group')
  const groupA = page.locator(`[data-testid="library-group"][data-workspace-id="${wsA.data.workspaceId}"]`)
  const groupB = page.locator(`[data-testid="library-group"][data-workspace-id="${wsB.data.workspaceId}"]`)
  const loose = page.locator('[data-testid="library-group"][data-workspace-id=""]')
  await expect(groups.nth(0)).toHaveAttribute('data-workspace-id', wsB.data.workspaceId, { timeout: 15_000 })
  await expect(groups.nth(1)).toHaveAttribute('data-workspace-id', wsA.data.workspaceId)
  await expect(groupB.getByRole('heading', { level: 2 })).toHaveText(nameB)
  await expect(groupA.getByRole('heading', { level: 2 })).toHaveText(nameA)
  expect(await libraryIds(groupA)).toEqual([FIXTURE_ID])
  const inB = await libraryIds(groupB)
  expect([...inB].sort()).toEqual([FIXTURE_ID, FIVE_ID].sort())
  // Within a group the rows keep their last-opened order.
  expect(inB).toEqual(opened.filter((id) => inB.includes(id)))
  await expect(loose).toHaveCount(1)
  await expect(groups.last()).toHaveAttribute('data-workspace-id', '')
  await expect(loose.getByRole('heading', { level: 2 })).toHaveText('Not in a workspace')
  await expect(rowOf(LONG_ID, loose)).toBeVisible()
  // Every paper is listed under at least one heading.
  const grouped = new Set<string>()
  for (const g of await groups.all()) for (const id of await libraryIds(g)) grouped.add(id)
  expect([...grouped].sort()).toEqual([...opened].sort())

  // Topic: a searchable list of the topics in Bob's papers, most used first, picked with the keyboard.
  await topicButton.click()
  const picker = page.getByTestId('library-topic-picker')
  const search = picker.getByRole('combobox', { name: 'Search topics' })
  await expect(search).toBeFocused()
  const options = picker.getByRole('option')
  await expect(options.first()).toBeVisible()
  const counts = await options.evaluateAll((els) => els.map((e) => Number(e.lastElementChild?.textContent)))
  expect(counts).toEqual([...counts].sort((a, b) => b - a))
  await page.keyboard.type('accuracy metric')
  await expect(options).toHaveCount(1)
  const label = (await options.first().getAttribute('aria-label')) ?? ''
  expect(label).toMatch(/^Accuracy metric \(fixture\), \d+ papers?$/)
  const usedBy = Number(/, (\d+) papers?$/.exec(label)![1])
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(page).toHaveURL(/\/library\?sort=workspace&topic=fixture-accuracy-metric$/)
  const chip = page.getByTestId('library-topic-chip')
  await expect(chip).toHaveText('Topic: Accuracy metric (fixture)')
  // Only papers with the topic are left, still grouped: A's only paper is gone, B keeps FIVE_ID.
  await expect(rowOf(FIXTURE_ID)).toHaveCount(0)
  await expect(rowOf(LONG_ID)).toHaveCount(0)
  await expect(groupA).toHaveCount(0)
  expect(await libraryIds(groupB)).toEqual([FIVE_ID])
  for (const id of await libraryIds(list)) expect(id).toMatch(/33$/)

  // A reload keeps the sort and the topic.
  await page.reload()
  await expect(page).toHaveURL(/\/library\?sort=workspace&topic=fixture-accuracy-metric$/)
  await expect(chip).toHaveText('Topic: Accuracy metric (fixture)')
  await expect(sort.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rowOf(FIVE_ID, groupB)).toBeVisible({ timeout: 15_000 })
  await expect(rowOf(FIXTURE_ID)).toHaveCount(0)

  // So does Back from a paper. Changing the sort or topic replaces the history entry instead of adding one.
  // The title opens the paper (the row's workspace chips are links too).
  await rowOf(FIVE_ID, groupB).getByRole('link', { name: FIXTURE_TITLE, exact: true }).click()
  await expect(page).toHaveURL(/\/p\/0000~00033$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/library\?sort=workspace&topic=fixture-accuracy-metric$/)
  await expect(chip).toBeVisible()
  await expect(rowOf(FIVE_ID, groupB)).toBeVisible({ timeout: 15_000 })

  // The topic combines with the status filter: In progress keeps the paper, Finished leaves an empty state that clears both.
  await status.getByRole('button', { name: 'In progress' }).click()
  await expect(rowOf(FIVE_ID, groupB)).toBeVisible()
  await status.getByRole('button', { name: 'Finished' }).click()
  const empty = page.getByTestId('library-empty')
  await expect(empty).toContainText('No finished papers use the topic Accuracy metric (fixture).')
  await empty.getByRole('button', { name: 'Clear filters' }).click()
  await expect(chip).toHaveCount(0)
  await expect(page).toHaveURL(/\/library\?sort=workspace$/)
  await expect(status.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rowOf(FIXTURE_ID, groupA)).toBeVisible()
  await expect(rowOf(LONG_ID, loose)).toBeVisible()

  // In last-opened order the topic leaves exactly the papers its count names; the chip's clear button restores the list.
  await sort.getByRole('button', { name: 'Last opened' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await topicButton.click()
  await picker.getByRole('option', { name: /^Accuracy metric \(fixture\),/ }).click()
  await expect(page).toHaveURL(/\/library\?topic=fixture-accuracy-metric$/)
  await expect(page.getByTestId('library-group')).toHaveCount(0)
  await expect(page.getByTestId('library-row')).toHaveCount(usedBy)
  await expect(rowOf(FIVE_ID)).toBeVisible()
  await chip.getByRole('button', { name: 'Clear topic Accuracy metric (fixture)' }).click()
  await expect(chip).toHaveCount(0)
  await expect(page).toHaveURL(/\/library$/)
  await expect(topicButton).toBeFocused()
  expect(await libraryIds(list)).toEqual(opened)

  // At 390px the controls wrap, with the chip, and nothing scrolls sideways.
  await page.goto('/library?sort=workspace&topic=fixture-accuracy-metric')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await expect(rowOf(FIVE_ID, groupB)).toBeVisible({ timeout: 15_000 })
  const boxes = await Promise.all([status, sort, topicButton, chip].map(async (l) => (await l.boundingBox())!))
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y)
  for (const b of boxes) expect(b.x + b.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await topicButton.click()
  await expect(picker).toBeVisible()
  const pickerBox = (await picker.boundingBox())!
  expect(pickerBox.x).toBeGreaterThanOrEqual(0)
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(topicButton).toBeFocused()
})

/** Cards, own-topic dots and topic nodes (with their labels) of the constellation that leave its canvas. */
async function constellationFits(page: Page) {
  return page.getByTestId('library-constellation').evaluate((frame) => {
    const box = frame.getBoundingClientRect()
    const outside: string[] = []
    const check = (el: Element, name: string) => {
      const r = el.getBoundingClientRect()
      if (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1) outside.push(name)
    }
    frame.querySelectorAll('[data-testid="constellation-card"]').forEach((el) => check(el, `card ${el.getAttribute('data-arxiv')}`))
    frame.querySelectorAll('[data-testid="constellation-dot"]').forEach((el, i) => check(el, `dot ${i}`))
    frame.querySelectorAll('[data-testid="constellation-topic"]').forEach((el) => {
      check(el.querySelector('.cl-node')!, `topic ${el.getAttribute('data-topic-key')}`)
      check(el.querySelector('text')!, `label ${el.getAttribute('data-topic-key')}`)
    })
    return outside
  })
}

/** The arXiv ids of the constellation's cards, sorted. */
function constellationIds(page: Page): Promise<string[]> {
  return page
    .getByTestId('constellation-card')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-arxiv') ?? '').sort())
}

test('the library constellation draws the filtered papers, selects cards to show what they share, and gives way to the list at 390px', async ({ users }) => {
  test.setTimeout(300_000)
  // Bob only opens papers in these specs and never finishes one. Cara or Ada (whoever has a slot) makes a paper
  // whose conversion fails: it has no topics, so it shares none with the fixture papers. The slot is given back.
  const [ada, bob, cara] = await users(['Schema ada', 'Schema bob', 'Schema cara'])
  const page = bob.page
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const id of [FIXTURE_ID, FIVE_ID, LONG_ID]) await openReadyFixturePaper(ada.page, id)
  let maker = cara.page
  if ((await allowanceLeft(maker)) === 0) maker = ada.page
  test.skip((await allowanceLeft(maker)) === 0, 'Cara and Ada are at the daily cap in this local state')
  await calm(maker)
  const failedId = await newFixtureId(maker, '77')
  await analyzeUntilFailed(maker, failedId, 'Fixture conversion failure')
  // Opening a paper only lists it in Recent papers, so Bob saves each one into his Library.
  for (const id of [FIXTURE_ID, FIVE_ID, LONG_ID, failedId]) {
    const slug = id.replace('.', '~')
    await page.goto(`/p/${slug}`)
    await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', /ready|failed/, { timeout: 20_000 })
    await expect(page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toBeVisible({ timeout: 15_000 })
    await saveFromPaperPage(page)
  }

  await page.goto('/library')
  const rowOf = (id: string) => page.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)
  const viewToggle = page.getByRole('group', { name: 'Library view' })
  const status = page.getByRole('group', { name: 'Filter papers' })
  const canvas = page.getByTestId('library-constellation')
  const cardOf = (id: string) => page.locator(`[data-testid="constellation-card"][data-arxiv="${id}"]`)
  const topicNode = (key: string) => page.locator(`[data-testid="constellation-topic"][data-topic-key="${key}"]`)
  const panel = page.getByTestId('constellation-selection')
  const panelStatus = page.getByTestId('constellation-selection-status')
  await expect(rowOf(failedId)).toBeVisible({ timeout: 15_000 })
  await expect(rowOf(FIXTURE_ID).getByTestId('library-known')).toContainText(/\d+ \/ \d+/, { timeout: 15_000 })
  const listed = (await libraryIds(page.getByTestId('library-page'))).sort()
  const [known, total] = (await rowOf(FIXTURE_ID).getByTestId('library-known').locator('b').innerText()).split(' / ')

  // List is the default and leaves the URL alone. Constellation adds ?view=constellation and hides Sort.
  await expect(viewToggle.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveCount(0)
  await viewToggle.getByRole('button', { name: 'Constellation' }).click()
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 15_000 })
  await expect(page.getByTestId('library-row')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Sort papers' })).toHaveCount(0)
  // One card per listed paper, with the list's counts.
  expect(await constellationIds(page)).toEqual(listed)
  await expect(cardOf(FIXTURE_ID).getByTestId('constellation-known')).toHaveText(`${known} of ${total} known`)
  await expect(cardOf(failedId).getByTestId('constellation-known')).toHaveText('Analysis failed')
  // The fixture papers share their topics, so each is a node; FIVE_ID's extra topic is one of its own dots.
  await expect(topicNode('softmax-function')).toBeVisible()
  await expect(topicNode('fixture-accuracy-metric')).toHaveCount(0)
  expect(await constellationFits(page)).toEqual([])

  // A reload keeps the view.
  await page.reload()
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  await expect(viewToggle.getByRole('button', { name: 'Constellation' })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 15_000 })
  expect(await constellationIds(page)).toEqual(listed)

  // Hovering a card highlights its links and names what it shares.
  await cardOf(FIVE_ID).hover()
  const tip = page.getByTestId('constellation-tip')
  await expect(tip).toHaveAttribute('data-on', 'true')
  await expect(tip).toContainText('Shares topics with')
  await expect(page.locator(`[data-link$="${await cardOf(FIVE_ID).getAttribute('data-paper-id')}"]`).first()).toHaveAttribute('data-hi')
  await expect(cardOf(failedId)).toHaveAttribute('data-dim')
  await page.mouse.move(2, 2)
  await expect(cardOf(failedId)).not.toHaveAttribute('data-dim')

  // One selected card keeps its topics at full strength after the pointer leaves, and shows an Open link.
  await cardOf(FIVE_ID).getByTestId('constellation-select').click()
  await page.mouse.move(2, 2)
  await expect(cardOf(FIVE_ID)).toHaveAttribute('data-selected', 'true')
  await expect(cardOf(FIVE_ID).getByTestId('constellation-select')).toHaveAttribute('aria-pressed', 'true')
  await expect(topicNode('softmax-function')).not.toHaveAttribute('data-dim')
  await expect(cardOf(failedId)).toHaveAttribute('data-dim')
  await expect(panel).toHaveAttribute('data-count', '1')
  await expect(panelStatus).toHaveText(/^1 paper selected\. It shares \d+ topics with other papers here\.$/)
  await expect(cardOf(FIVE_ID).getByTestId('constellation-open')).toBeVisible()
  await expect(cardOf(FIXTURE_ID).getByTestId('constellation-open')).toHaveCount(0)

  // Two papers that share topics: the panel lists them, and a topic both use stays at full strength.
  await cardOf(FIXTURE_ID).getByTestId('constellation-select').click()
  await page.mouse.move(2, 2)
  await expect(panel).toHaveAttribute('data-count', '2')
  await expect(panelStatus).toHaveText(/^2 papers selected\. They share \d+ topics\.$/)
  await expect(panel.locator('[data-testid="constellation-selection-topic"][data-topic-key="softmax-function"]')).toContainText('Softmax function')
  await expect(panel.getByTestId('constellation-selection-paper')).toHaveCount(2)
  await expect(topicNode('softmax-function')).toHaveAttribute('data-all')
  await expect(topicNode('softmax-function')).not.toHaveAttribute('data-dim')
  // Esc clears the selection.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveAttribute('data-count', '0')
  await expect(page.locator('[data-testid="constellation-card"][data-selected]')).toHaveCount(0)

  // Two papers with no shared topic say so. Space and Enter on a focused card toggle it too.
  await cardOf(FIXTURE_ID).getByTestId('constellation-select').focus()
  await page.keyboard.press('Space')
  await cardOf(failedId).getByTestId('constellation-select').focus()
  await page.keyboard.press('Enter')
  await expect(panel).toHaveAttribute('data-count', '2')
  await expect(panelStatus).toHaveText('2 papers selected. These papers share no topics.')
  await expect(panel.getByTestId('constellation-selection-topic')).toHaveCount(0)
  // Clear clears it.
  await panel.getByTestId('constellation-clear').click()
  await expect(panel).toHaveAttribute('data-count', '0')

  // A drag moves a card without selecting it; a click on empty canvas clears a selection, but the end of a drag doesn't.
  await cardOf(LONG_ID).getByTestId('constellation-select').click()
  await expect(panel).toHaveAttribute('data-count', '1')
  const before = (await cardOf(FIXTURE_ID).boundingBox())!
  const frameBox = (await canvas.boundingBox())!
  // 50px toward the canvas center, so the canvas edge never stops the card.
  const toward = Math.atan2(frameBox.y + frameBox.height / 2 - before.y, frameBox.x + frameBox.width / 2 - before.x)
  await page.mouse.move(before.x + 20, before.y + 20)
  await page.mouse.down()
  await page.mouse.move(before.x + 20 + Math.cos(toward) * 50, before.y + 20 + Math.sin(toward) * 50, { steps: 6 })
  await expect.poll(async () => {
    const now = (await cardOf(FIXTURE_ID).boundingBox())!
    return Math.round(Math.hypot(now.x - before.x, now.y - before.y))
  }).toBeGreaterThan(30)
  await page.mouse.up()
  await expect(cardOf(FIXTURE_ID)).not.toHaveAttribute('data-selected', 'true')
  await expect(panel).toHaveAttribute('data-count', '1')
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  // Under reduced motion the card returns to its place on release.
  await expect.poll(async () => Math.round((await cardOf(FIXTURE_ID).boundingBox())!.y)).toBe(Math.round(before.y))
  await canvas.click({ position: { x: 6, y: 6 } })
  await expect(panel).toHaveAttribute('data-count', '0')

  // With motion the cards drift and the rings turn, and everything stays inside the canvas.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(canvas).toHaveAttribute('data-settled', 'false')
  await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 30_000 })
  for (let i = 0; i < 3; i++) {
    expect(await constellationFits(page)).toEqual([])
    await page.waitForTimeout(400)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(canvas).toHaveAttribute('data-settled', 'true')

  // The Topic and status filters decide which cards appear.
  await page.getByRole('button', { name: 'Filter by topic' }).click()
  const picker = page.getByTestId('library-topic-picker')
  await picker.getByRole('option', { name: /^Accuracy metric \(fixture\),/ }).click()
  await expect(page).toHaveURL(/\/library\?topic=fixture-accuracy-metric&view=constellation$/)
  await expect.poll(async () => (await constellationIds(page)).every((id) => id.endsWith('33'))).toBe(true)
  await expect(cardOf(FIVE_ID)).toBeVisible()
  await page.getByTestId('library-topic-clear').click()
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  await expect.poll(() => constellationIds(page)).toEqual(listed)
  await status.getByRole('button', { name: 'Finished' }).click()
  await expect(page.getByTestId('library-empty')).toHaveText('No finished papers yet. Papers you mark finished are listed here.')
  await expect(canvas).toHaveCount(0)
  await status.getByRole('button', { name: 'In progress' }).click()
  await expect.poll(() => constellationIds(page)).toEqual(listed)

  // A selected card's Open link opens its paper; Back returns to the constellation with nothing selected.
  await cardOf(FIVE_ID).getByTestId('constellation-select').click()
  await cardOf(FIVE_ID).getByTestId('constellation-open').click()
  await expect(page).toHaveURL(/\/p\/0000~00033$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  await expect(cardOf(FIVE_ID)).toBeVisible({ timeout: 15_000 })
  await expect(panel).toHaveAttribute('data-count', '0')

  // At 390px the toggle is gone and the list shows, though the URL still asks for the constellation.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(viewToggle).toHaveCount(0)
  await expect(canvas).toHaveCount(0)
  await expect(rowOf(FIVE_ID)).toBeVisible()
  await expect(page).toHaveURL(/\/library\?view=constellation$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  // Back at 1440 the constellation returns; List drops the parameter.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(canvas).toBeVisible()
  await viewToggle.getByRole('button', { name: 'List' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(canvas).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Sort papers' })).toBeVisible()
  expect(errors).toEqual([])
})

/** Wait until the Library has its membership (roadmaps, workspaces and checkmarks) and shows rows or its empty state. */
async function libraryLoaded(page: Page) {
  await expect(page.getByTestId('library-page')).toBeVisible()
  await expect(page.getByTestId('library-loading')).toHaveCount(0, { timeout: 15_000 })
}

/** Opens the paper page's placement popover. */
async function openPlacement(page: Page) {
  const trigger = page.getByTestId('placement-open')
  await expect(trigger).toBeEnabled({ timeout: 15_000 })
  await trigger.click()
  const popover = page.getByTestId('placement-popover')
  await expect(popover).toBeVisible()
  return popover
}

/** Saves the open paper in the Library with the placement control, unless it is in it already. */
async function saveFromPaperPage(page: Page) {
  const trigger = page.getByTestId('placement-open')
  await expect(trigger).toBeEnabled({ timeout: 15_000 })
  if ((await trigger.getAttribute('data-member')) === 'true') return
  const popover = await openPlacement(page)
  await popover.getByRole('checkbox', { name: 'In my Library' }).click()
  await expect(trigger).toHaveAttribute('data-member', 'true', { timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
}

/** Takes the open paper out of the Library and every workspace (Remove from Library), when it is in the Library. */
async function removeFromLibrary(page: Page) {
  const trigger = page.getByTestId('placement-open')
  await expect(trigger).toBeEnabled({ timeout: 15_000 })
  if ((await trigger.getAttribute('data-member')) !== 'true') return
  const popover = await openPlacement(page)
  await popover.getByTestId('placement-remove').click()
  await page.getByTestId('placement-remove-confirm').click()
  await expect(trigger).toHaveAttribute('data-member', 'false', { timeout: 15_000 })
}

/** Opens an analyzed paper's own page and waits for it, its placement control and its read state. */
async function openPaperPage(page: Page, id: string) {
  await page.goto(`/p/${id.replace('.', '~')}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', /ready|failed/, { timeout: 20_000 })
  await expect(page.getByTestId('placement-open')).toBeEnabled({ timeout: 15_000 })
}

/**
 * A fixture paper nobody had analyzed, requested now by the first of `pages`
 * with a daily slot and ready, or null when they are all at the cap. Ids
 * with a special fixture (33, 44, 55) are skipped.
 */
async function freshReadyPaper(pages: Page[]): Promise<string | null> {
  for (const page of pages) {
    if ((await allowanceLeft(page)) === 0) continue
    await calm(page)
    let id = await newFixtureId(page, '')
    while (/(33|44|55)$/.test(id)) id = await newFixtureId(page, '')
    await openFromHome(page, id)
    await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: READY_TIMEOUT })
    return id
  }
  return null
}

test('opening an analyzed paper leaves it out of the Library but lists it in Recent papers; checking a concept adds it', async ({ users }) => {
  test.setTimeout(200_000)
  // Bob analyzes a paper Dana has never seen, so her state for it starts empty. The daily-cap spec uses up
  // Bob's papers anyway, so this leaves Cara's and Ada's slots to the failure specs; they stand in when he is out.
  const [ada, bob, cara, dana] = await users(['Schema ada', 'Schema bob', 'Schema cara', 'Schema dana'])
  const id = await freshReadyPaper([bob.page, cara.page, ada.page])
  test.skip(!id, 'Bob, Cara and Ada are at the daily cap in this local state')
  const slug = id!.replace('.', '~')
  const page = dana.page
  await calm(page)
  await openPaperPage(page, id!)
  await expect(page.getByTestId('placement-open')).toHaveText('Save')
  await expect(page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toBeVisible({ timeout: 15_000 })

  const rowOf = () => page.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(rowOf()).toHaveCount(0)
  // Opened, so it is still in the history.
  await expect(page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toBeVisible()

  // Checking one concept puts it in the Library, filed nowhere.
  await openPaperPage(page, id!)
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placement-open')).toHaveText('In Library')
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(rowOf()).toBeVisible()
  await expect(rowOf().getByTestId('library-no-workspace')).toHaveText('No workspace')

  // Unchecking it again leaves a paper the reader never saved: it drops out.
  await openPaperPage(page, id!)
  await openBranch(page, 'foundations')
  await resetStatus(page, 'c1')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placement-open')).toHaveText('Save')
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(rowOf()).toHaveCount(0)
})

test('a paper the reader starts analyzing goes in their Library without a workspace; another reader opening it does not get it', async ({ users }) => {
  test.setTimeout(200_000)
  // Bob requests it: the daily-cap spec uses up his papers anyway, which leaves Cara's and Ada's to the failure specs.
  const [, bob, dana] = await users(['Schema ada', 'Schema bob', 'Schema dana'])
  test.skip((await allowanceLeft(bob.page)) === 0, 'Bob is at the daily cap in this local state')
  let id = await newFixtureId(bob.page, '')
  while (/(33|44|55)$/.test(id)) id = await newFixtureId(bob.page, '')
  const slug = id.replace('.', '~')
  const started = await action(bob.page, 'analyzePaper', { input: id })
  expect(started.success).toBe(true)
  expect(started.data).toMatchObject({ arxivId: id, existing: false })
  expect(started.data.workspaceId).toBeUndefined()

  // In Bob's Library at once, filed nowhere, and still out of his Recent papers, since he has not opened it.
  const bobRow = bob.page.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)
  await bob.page.goto('/library')
  await libraryLoaded(bob.page)
  await expect(bobRow).toBeVisible({ timeout: 15_000 })
  await expect(bobRow.getByTestId('library-no-workspace')).toHaveText('No workspace')
  await expect(bob.page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toHaveCount(0)
  await expect(bobRow).toHaveAttribute('data-paper-status', 'ready', { timeout: READY_TIMEOUT })

  // Dana only opens it: it joins her Recent papers, not her Library.
  const page = dana.page
  await calm(page)
  await openPaperPage(page, id)
  await expect(page.getByTestId('placement-open')).toHaveText('Save')
  await expect(page.getByTestId('sidebar-recent').locator(`a[href="/p/${slug}"]`)).toBeVisible({ timeout: 15_000 })
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(page.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)).toHaveCount(0)
})

test('Save puts a paper in the Library and unsaving takes it out, checkmarks or not', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  await openReadyFixturePaper(ada.page, SECOND_ID)
  const page = dana.page
  await calm(page)
  await openPaperPage(page, SECOND_ID)
  // Start from a paper outside the Library, whatever earlier runs left.
  await removeFromLibrary(page)
  const trigger = page.getByTestId('placement-open')
  const rowOf = () => page.locator(`[data-testid="library-row"][data-arxiv="${SECOND_ID}"]`)
  await expect(trigger).toHaveText('Save')

  // The popover: In my Library, the workspaces, New workspace, and no Remove while the paper is out.
  const popover = await openPlacement(page)
  await expect(popover).toHaveAccessibleName(`Library and workspaces for ${FIXTURE_TITLE}`)
  const box = popover.getByRole('checkbox', { name: 'In my Library' })
  await expect(box).not.toBeChecked()
  await expect(popover.getByRole('textbox', { name: 'New workspace name' })).toBeVisible()
  await expect(popover.getByTestId('placement-remove')).toHaveCount(0)
  await box.click()
  await expect(box).toBeChecked()
  await expect(trigger).toHaveText('In Library', { timeout: 15_000 })
  await expect(popover.getByTestId('placement-remove')).toBeVisible()
  // Esc closes it and gives focus back to the button.
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.goto('/library')
  await libraryLoaded(page)
  await expect(rowOf()).toBeVisible()
  await expect(rowOf()).toContainText(/Saved|Opened/)

  // Unsave from the row's own control. The paper is in no workspace, so it leaves at once.
  await rowOf().getByTestId('library-place').click()
  const rowPopover = page.getByTestId('placement-popover')
  await rowPopover.getByRole('checkbox', { name: 'In my Library' }).click()
  await expect(rowOf()).toHaveCount(0, { timeout: 15_000 })

  // Removed by the reader, a checkmark no longer brings it back.
  await openPaperPage(page, SECOND_ID)
  await expect(trigger).toHaveText('Save')
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveText('Save')
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(rowOf()).toHaveCount(0)
  await openPaperPage(page, SECOND_ID)
  await openBranch(page, 'foundations')
  await resetStatus(page, 'c1')
  await page.keyboard.press('Escape')
})

test('the paper page control files a paper in two workspaces, and its Library row links both', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  await openReadyFixturePaper(ada.page, FIVE_ID)
  const page = dana.page
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPaperPage(page, FIVE_ID)
  await removeFromLibrary(page)
  const trigger = page.getByTestId('placement-open')
  const stamp = Date.now()
  const nameA = `[fixture] Filed A ${stamp}`
  const nameB = `[fixture] Filed B ${stamp}`

  // New workspace creates the workspace with the paper in it, and the button names it.
  let popover = await openPlacement(page)
  const field = popover.getByRole('textbox', { name: 'New workspace name' })
  await field.fill(nameA)
  await page.keyboard.press('Enter')
  const rowA = popover.locator('[data-testid="placement-workspace"]').filter({ hasText: nameA })
  await expect(rowA.getByRole('checkbox', { name: nameA })).toBeChecked({ timeout: 15_000 })
  await expect(field).toHaveValue('')
  await expect(trigger).toHaveText(`In ${nameA}`)
  await expect(popover.getByRole('checkbox', { name: 'In my Library' })).toBeChecked()
  await field.fill(nameB)
  await popover.getByTestId('placement-new-create').click()
  const rowB = popover.locator('[data-testid="placement-workspace"]').filter({ hasText: nameB })
  await expect(rowB.getByRole('checkbox', { name: nameB })).toBeChecked({ timeout: 15_000 })
  await expect(trigger).toHaveText(/^In \[fixture\] Filed [AB] \d+ \+1$/)

  // Unchecking one workspace takes the paper out of that one only, and checking it puts it back.
  await rowB.getByRole('checkbox', { name: nameB }).click()
  await expect(rowB.getByRole('checkbox', { name: nameB })).not.toBeChecked()
  await expect(trigger).toHaveText(`In ${nameA}`, { timeout: 15_000 })
  await rowB.getByRole('checkbox', { name: nameB }).click()
  await expect(trigger).toHaveText(/\+1$/, { timeout: 15_000 })
  const idA = (await rowA.getAttribute('data-workspace-id'))!
  const idB = (await rowB.getAttribute('data-workspace-id'))!
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)

  // The Library row names both workspaces as links, between the title and the counts.
  await page.goto('/library')
  await libraryLoaded(page)
  const row = page.locator(`[data-testid="library-row"][data-arxiv="${FIVE_ID}"]`)
  const chips = row.getByTestId('library-workspace-chip')
  await expect(chips).toHaveCount(2)
  await expect(row.locator(`[data-testid="library-workspace-chip"][data-workspace-id="${idA}"]`)).toHaveText(nameA)
  await expect(row.locator(`[data-testid="library-workspace-chip"][data-workspace-id="${idB}"]`)).toHaveAttribute('href', `/w/${idB}`)
  const [title, section, known, action] = await Promise.all(
    [row.getByRole('link').first(), row.getByTestId('library-row-workspaces'), row.getByTestId('library-known'), row.getByTestId('library-finish')].map(async (l) => (await l.boundingBox())!),
  )
  expect(title.x + title.width).toBeLessThanOrEqual(section.x)
  expect(section.x + section.width).toBeLessThanOrEqual(known.x)
  expect(known.x + known.width).toBeLessThanOrEqual(action.x)
  // The row's own control shows the same two workspaces checked.
  await row.getByTestId('library-place').click()
  popover = page.getByTestId('placement-popover')
  await expect(popover.getByRole('checkbox', { name: nameA })).toBeChecked()
  await expect(popover.getByRole('checkbox', { name: nameB })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(row.getByTestId('library-place')).toBeFocused()

  // At 390px the row stacks, the chips under the title, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  const [t2, s2] = await Promise.all([row.getByRole('link').first(), row.getByTestId('library-row-workspaces')].map(async (l) => (await l.boundingBox())!))
  expect(s2.y).toBeGreaterThan(t2.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1440, height: 900 })

  // A chip opens its workspace, which holds the paper.
  await row.locator(`[data-testid="library-workspace-chip"][data-workspace-id="${idA}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/w/${idA}$`))
  await expect(page.locator(`[data-testid="workspace-paper"][data-arxiv="${FIVE_ID}"]`)).toBeVisible({ timeout: 15_000 })
})

test('Remove from Library asks first, names the workspaces, keeps the checkmarks and empties those workspaces', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  await openReadyFixturePaper(ada.page, LONG_ID)
  const page = dana.page
  await calm(page)
  await openPaperPage(page, LONG_ID)
  const trigger = page.getByTestId('placement-open')
  const name = `[fixture] To remove ${Date.now()}`
  const popover = await openPlacement(page)
  await popover.getByRole('textbox', { name: 'New workspace name' }).fill(name)
  await popover.getByTestId('placement-new-create').click()
  const wsRow = popover.locator('[data-testid="placement-workspace"]').filter({ hasText: name })
  await expect(wsRow.getByRole('checkbox', { name })).toBeChecked({ timeout: 15_000 })
  const wsId = (await wsRow.getAttribute('data-workspace-id'))!
  await page.keyboard.press('Escape')
  await openBranch(page, 'foundations')
  await ensureKnown(page, 'c1')
  await page.keyboard.press('Escape')

  // Unchecking In my Library while the paper is in a workspace asks the same question as Remove from Library.
  await openPlacement(page)
  await page.getByTestId('placement-popover').getByRole('checkbox', { name: 'In my Library' }).click()
  const confirm = page.getByRole('dialog', { name: /^Remove .+ from your Library\?$/ })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByTestId('placement-remove-text')).toContainText(name)
  await expect(confirm.getByTestId('placement-remove-text')).toContainText('Your checkmarks stay, so your progress is kept if you add it again.')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('data-member', 'true')

  await openPlacement(page)
  await page.getByTestId('placement-remove').click()
  await expect(confirm).toBeVisible()
  await confirm.getByTestId('placement-remove-confirm').click()
  await expect(confirm).toHaveCount(0)
  await expect(trigger).toHaveText('Save', { timeout: 15_000 })
  await expect(trigger).toBeFocused()

  // Out of the Library and the workspace, and the checkmark stays.
  await page.goto('/library')
  await libraryLoaded(page)
  await expect(page.locator(`[data-testid="library-row"][data-arxiv="${LONG_ID}"]`)).toHaveCount(0)
  await page.goto(`/w/${wsId}`)
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 15_000 })
  await expect(page.getByTestId('workspace-paper')).toHaveCount(0)
  await openPaperPage(page, LONG_ID)
  await openBranch(page, 'foundations')
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'known')
  await resetStatus(page, 'c1')
  await page.keyboard.press('Escape')
})

test('the Workspace filter keeps ?ws= in the URL: none shows only unfiled papers, an id only that workspace', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  for (const id of [FIXTURE_ID, SECOND_ID]) await openReadyFixturePaper(ada.page, id)
  const page = dana.page
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  // SECOND_ID is saved in no workspace, and FIXTURE_ID goes into a new one.
  await openPaperPage(page, SECOND_ID)
  await removeFromLibrary(page)
  await saveFromPaperPage(page)
  const name = `[fixture] Filter ${Date.now()}`
  const added = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name } })
  expect(added.success).toBe(true)
  const wsId = added.data.workspaceId as string

  await page.goto('/library?ws=none')
  await libraryLoaded(page)
  const rows = page.getByTestId('library-row')
  const rowOf = (id: string) => page.locator(`[data-testid="library-row"][data-arxiv="${id}"]`)
  await expect(rowOf(SECOND_ID)).toBeVisible()
  await expect(rowOf(FIXTURE_ID)).toHaveCount(0)
  for (const r of await rows.all()) await expect(r.getByTestId('library-no-workspace')).toBeVisible()
  await expect(page.getByTestId('library-ws-chip')).toHaveText('Not in a workspace')

  // The picker lists every workspace, then Not in a workspace, with counts. Picking one replaces ?ws=.
  const wsButton = page.getByRole('button', { name: 'Filter by workspace' })
  await wsButton.click()
  const picker = page.getByTestId('library-ws-picker')
  const search = picker.getByRole('combobox', { name: 'Search workspaces' })
  await expect(search).toBeFocused()
  await expect(picker.getByRole('option').last()).toHaveAccessibleName(/^Not in a workspace, \d+ papers?, current filter$/)
  await search.fill(name)
  await expect(picker.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/library\\?ws=${wsId}$`))
  await expect(page.getByTestId('library-ws-chip')).toHaveText(`Workspace: ${name}`)
  await expect(rowOf(FIXTURE_ID)).toBeVisible()
  await expect(rows).toHaveCount(1)

  // It combines with the status filter and the Workspace sort, and the empty state names it.
  await page.getByRole('group', { name: 'Sort papers' }).getByRole('button', { name: 'Workspace' }).click()
  await expect(page).toHaveURL(new RegExp(`/library\\?sort=workspace&ws=${wsId}$`))
  await expect(page.locator(`[data-testid="library-group"][data-workspace-id="${wsId}"]`).getByTestId('library-row')).toHaveCount(1)
  await page.getByRole('group', { name: 'Filter papers' }).getByRole('button', { name: 'Finished' }).click()
  const empty = page.getByTestId('library-empty')
  await expect(empty).toContainText(`No finished papers in ${name}.`)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/library\\?sort=workspace&ws=${wsId}$`))
  await expect(page.getByTestId('library-ws-chip')).toHaveText(`Workspace: ${name}`)
  await page.goto('/library?ws=none&topic=fixture-accuracy-metric')
  await libraryLoaded(page)
  await expect(page.getByTestId('library-empty')).toContainText('No papers outside a workspace use the topic Accuracy metric (fixture).')
  await page.getByTestId('library-empty').getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await page.goto('/library?ws=none')
  await libraryLoaded(page)
  await page.getByTestId('library-ws-clear').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(wsButton).toBeFocused()
  await expect(rowOf(FIXTURE_ID)).toBeVisible()
})

test('the constellation adds the selected papers to a workspace and saves them', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  for (const id of [FIXTURE_ID, SECOND_ID]) await openReadyFixturePaper(ada.page, id)
  const page = dana.page
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const id of [FIXTURE_ID, SECOND_ID]) {
    await openPaperPage(page, id)
    await saveFromPaperPage(page)
  }
  await page.goto('/library?view=constellation')
  await libraryLoaded(page)
  const canvas = page.getByTestId('library-constellation')
  await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 15_000 })
  const cardOf = (id: string) => page.locator(`[data-testid="constellation-card"][data-arxiv="${id}"]`)
  const panel = page.getByTestId('constellation-selection')
  await expect(panel.getByTestId('constellation-add')).toHaveCount(0)
  await cardOf(FIXTURE_ID).getByTestId('constellation-select').click()
  await cardOf(SECOND_ID).getByTestId('constellation-select').click()
  await expect(panel).toHaveAttribute('data-count', '2')

  // Add to workspace only adds: a new workspace takes both, and shows checked and read-only.
  const add = panel.getByTestId('constellation-add')
  await expect(add).toHaveText('Add to workspace')
  await add.click()
  const popover = page.getByTestId('placement-popover')
  await expect(popover).toHaveAttribute('data-mode', 'add')
  await expect(popover).toHaveAccessibleName('Add 2 papers to a workspace')
  await expect(popover.getByRole('checkbox', { name: 'In my Library' })).toHaveCount(0)
  await expect(popover.getByTestId('placement-remove')).toHaveCount(0)
  const name = `[fixture] From the constellation ${Date.now()}`
  await popover.getByRole('textbox', { name: 'New workspace name' }).fill(name)
  await popover.getByTestId('placement-new-create').click()
  await expect(popover.getByTestId('placement-note')).toHaveText(`Created ${name} with 2 papers.`, { timeout: 15_000 })
  const wsRow = popover.locator('[data-testid="placement-workspace"]').filter({ hasText: name })
  const box = wsRow.getByRole('checkbox', { name })
  await expect(box).toBeChecked()
  await expect(box).toHaveAttribute('aria-readonly', 'true')
  const wsId = (await wsRow.getAttribute('data-workspace-id'))!

  // An existing workspace holding one of them shows mixed, and checking it adds the other.
  const other = `[fixture] Holds one ${Date.now()}`
  const one = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: other } })
  expect(one.success).toBe(true)
  const otherBox = popover.getByRole('checkbox', { name: other })
  await expect(otherBox).toHaveAttribute('aria-checked', 'mixed', { timeout: 15_000 })
  await otherBox.click()
  await expect(otherBox).toBeChecked({ timeout: 15_000 })
  await expect(popover.getByTestId('placement-note')).toHaveText(`Added 2 papers to ${other}.`)
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(add).toBeFocused()
  // Esc in the popover left the selection alone.
  await expect(panel).toHaveAttribute('data-count', '2')

  for (const id of [wsId, one.data.workspaceId as string]) {
    await page.goto(`/w/${id}`)
    await expect(page.getByTestId('workspace-paper')).toHaveCount(2, { timeout: 15_000 })
  }
})

test('a new workspace made with papers from the Library holds them and asks for next-step picks', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada, dana] = await users(['Schema ada', 'Schema dana'])
  for (const id of [FIXTURE_ID, SECOND_ID]) await openReadyFixturePaper(ada.page, id)
  const page = dana.page
  await calm(page)
  for (const id of [FIXTURE_ID, SECOND_ID]) {
    await openPaperPage(page, id)
    await saveFromPaperPage(page)
  }
  await page.goto('/home')
  await page.getByTestId('add-open').first().click()
  await page.getByTestId('add-choice-workspace').click()
  const form = page.getByTestId('workspace-form')
  const name = `[fixture] From my Library ${Date.now()}`
  await form.getByLabel('Workspace name', { exact: true }).fill(name)
  const picker = form.getByTestId('workspace-library-picker')
  await expect(picker).toContainText('Add papers from your Library (optional)')
  await expect(form.getByTestId('workspace-recommend-note')).toContainText('three starter papers')
  // The search narrows the checklist by arXiv id or title. Checked papers stay checked while hidden.
  const search = picker.getByRole('searchbox', { name: 'Search your Library' })
  await search.fill(SECOND_ID)
  await expect(picker.getByTestId('workspace-library-option')).toHaveCount(1)
  await picker.locator(`[data-testid="workspace-library-option"][data-arxiv="${SECOND_ID}"]`).getByRole('checkbox').click()
  await search.fill(FIXTURE_ID)
  await picker.locator(`[data-testid="workspace-library-option"][data-arxiv="${FIXTURE_ID}"]`).getByRole('checkbox').click()
  await search.fill('')
  await expect(picker.locator(`[data-testid="workspace-library-option"][data-arxiv="${SECOND_ID}"]`).getByRole('checkbox')).toBeChecked()
  await expect(picker.getByTestId('workspace-library-count')).toHaveText('2 papers will be added.')
  await expect(form.getByTestId('workspace-recommend-note')).toContainText('follow on from the ones you add')

  const recommended = page.waitForRequest((r) => r.url().endsWith('/api/actions/recommendPapers'))
  await form.getByTestId('workspace-create').click()
  await expect(page.getByTestId('workspace-name')).toHaveText(name, { timeout: 15_000 })
  expect((await recommended).postDataJSON()).toMatchObject({ mode: 'next' })
  await expect(page.locator(`[data-testid="workspace-paper"][data-arxiv="${FIXTURE_ID}"]`)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`[data-testid="workspace-paper"][data-arxiv="${SECOND_ID}"]`)).toBeVisible()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(2)
  await expect(page.getByTestId('suggestion')).toHaveCount(2, { timeout: 15_000 })
})

test('Read again asks whether to uncheck what finishing checked, and reopens at once when finishing checked nothing', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('read-again').isVisible()) await readAgain(page, 'read-again')
  // c1 checked by the reader, c5 left for finishing to check.
  await openBranch(page, 'foundations')
  await resetStatus(page, 'c1')
  await ensureKnown(page, 'c1')
  await resetStatus(page, 'c5')
  await page.keyboard.press('Escape')
  await page.getByTestId('finish-toggle').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await openBranch(page, 'foundations')
  await expect(card(page, 'c5')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })
  await page.keyboard.press('Escape')

  // Read again asks, with the box unticked. Cancel leaves the paper finished.
  const ask = page.getByRole('dialog', { name: 'Read this paper again?' })
  const box = ask.getByRole('checkbox', { name: /^Also uncheck the \d+ concepts? checked when you finished$/ })
  await page.getByTestId('read-again').click()
  await expect(box).not.toBeChecked()
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  await expect(page.getByTestId('paper-finished')).toBeVisible()

  await page.getByTestId('read-again').click()
  await box.check()
  await ask.getByTestId('read-again-confirm').click()
  await expect(page.getByTestId('finish-toggle')).toBeVisible({ timeout: 15_000 })
  // Only what finishing checked is unchecked: c5 goes, c1 stays.
  await openBranch(page, 'foundations')
  await expect(card(page, 'c5')).toHaveAttribute('data-status', 'unknown', { timeout: 15_000 })
  await expect(card(page, 'c1')).toHaveAttribute('data-status', 'known')
  await page.keyboard.press('Escape')

  // Finished without checking the rest, there is nothing to uncheck, so Read again acts at once.
  await page.getByTestId('finish-toggle').click()
  await page.getByRole('checkbox', { name: 'Also check the remaining concepts in this paper' }).uncheck()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('paper-finished')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('read-again').click()
  await expect(page.getByTestId('finish-toggle')).toBeVisible({ timeout: 15_000 })
  await expect(ask).toHaveCount(0)
})

test('the library shows a placeholder, never 0 / 0, while its counts load', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // Record every count the fixture paper's row shows from the first paint on.
  await page.addInitScript((id) => {
    const w = window as unknown as { __counts: string[] }
    w.__counts = []
    new MutationObserver(() => {
      for (const row of document.querySelectorAll('[data-testid="library-row"]')) {
        if (!row.textContent?.includes(`arXiv ${id}`)) continue
        const t = row.querySelector('[data-testid="library-known"] b')?.textContent ?? ''
        if (w.__counts[w.__counts.length - 1] !== t) w.__counts.push(t)
      }
    }).observe(document, { subtree: true, childList: true, characterData: true })
  }, FIXTURE_ID)
  await page.goto('/library')
  const row = page.getByTestId('library-row').filter({ hasText: `arXiv ${FIXTURE_ID}` })
  await expect(row.getByTestId('library-known')).toContainText(/\d+ \/ 9/, { timeout: 15_000 })
  const counts = await page.evaluate(() => (window as unknown as { __counts: string[] }).__counts)
  expect(counts.length).toBeGreaterThan(0)
  expect(counts).not.toContain('0 / 0')
})

test('Home\'s Continue card counts one paper in the singular', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  // A workspace made by the action is opened last, so Home continues with it.
  const name = `[fixture] One paper ${Date.now()}`
  expect((await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name } })).success).toBe(true)
  await page.goto('/home')
  const continueCard = page.getByTestId('continue')
  await expect(continueCard).toContainText(name, { timeout: 15_000 })
  await expect(continueCard.getByRole('link', { name })).toContainText(/1 paper$/)
})

/** Calls a server action as the signed-in reader of `page`. */
async function action(page: Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then((r) => r.json())
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

test('the library finishes a paper with the same dialog, and both its buttons update the workspace entry', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  if (await page.getByTestId('read-again').isVisible()) await readAgain(page, 'read-again')
  await expect(page.getByTestId('finish-toggle')).toBeVisible()
  // A cached paper is free to add, so a fresh workspace holds it.
  const added = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: `[fixture] Library ${Date.now()}` } })
  expect(added.success).toBe(true)
  const entry = page.locator(`[data-testid="workspace-paper"][data-arxiv="${FIXTURE_ID}"]`)
  await openBranch(page, 'geometry')
  await resetStatus(page, 'c3')
  await page.keyboard.press('Escape')

  await page.goto('/library')
  const row = page.getByTestId('library-row').filter({ hasText: `arXiv ${FIXTURE_ID}` })
  await row.getByTestId('library-finish').click()
  await expect(page.getByTestId('finish-panel')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Also check the remaining concepts in this paper' })).toBeChecked()
  await page.getByTestId('finish-confirm').click()
  await expect(row).toHaveAttribute('data-status', 'finished', { timeout: 15_000 })

  // Finished in its workspace too, with the remaining concepts checked.
  await page.goto(`/w/${added.data.workspaceId}`)
  await expect(entry).toHaveAttribute('data-status', 'finished', { timeout: 15_000 })
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await openBranch(page, 'geometry')
  await expect(card(page, 'c3')).toHaveAttribute('data-status', 'known', { timeout: 15_000 })
  await page.keyboard.press('Escape')

  // Read again in the library reopens the workspace entry as well.
  await page.goto('/library')
  await readAgain(page, 'library-read-again', row)
  await expect(row).toHaveAttribute('data-status', 'reading', { timeout: 15_000 })
  await page.goto(`/w/${added.data.workspaceId}`)
  await expect(entry).toHaveAttribute('data-status', 'active', { timeout: 15_000 })
})

test('Remove from workspace in the paper window asks first, then goes back to the workspace', async ({ users }) => {
  test.setTimeout(150_000)
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await openReadyFixturePaper(page)
  const added = await action(page, 'analyzePaper', { input: FIXTURE_ID, newWorkspace: { name: `[fixture] Remove ${Date.now()}` } })
  expect(added.success).toBe(true)
  const paperUrl = `/w/${added.data.workspaceId}/p/${FIXTURE_SLUG}`
  await page.goto(paperUrl)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })

  const confirm = page.getByRole('dialog', { name: 'Remove this paper?' })
  await page.getByTestId('remove-from-workspace').click()
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${paperUrl}$`))

  await page.getByTestId('remove-from-workspace').click()
  await confirm.getByRole('button', { name: 'Remove paper' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${added.data.workspaceId}$`), { timeout: 15_000 })
  await expect(page.getByTestId('workspace-name')).toBeVisible()
  await expect(page.getByTestId('workspace-paper')).toHaveCount(0)
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
  await openFromHome(page, id)
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

  // The conversion itself fails: nothing was billed, so the slot comes back, and the failed card says so.
  await analyzeUntilFailed(requester.page, await newFixtureId(requester.page, '77'), 'Fixture conversion failure')
  await expect(requester.page.getByTestId('paper-failed-slot')).toHaveAttribute('data-slot', 'refunded')
  await expect(requester.page.getByTestId('paper-failed-slot')).toContainText('your new paper for today was given back')
  expect(await allowanceLeft(requester.page)).toBe(before)

  // A scanned PDF fails after the paid conversion: the slot stays used, and the card says that too.
  const scanned = await newFixtureId(requester.page, '99')
  await analyzeUntilFailed(requester.page, scanned, 'almost no extractable text')
  await expect(requester.page.getByTestId('paper-failed-slot')).toHaveAttribute('data-slot', 'counted')
  await expect(requester.page.getByTestId('paper-failed-slot')).toContainText('used one of your new papers for today')
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
  // Retrying started the analysis again, so the paper is now in the retrier's Library too.
  await retrier.page.goto('/library')
  await libraryLoaded(retrier.page)
  await expect(retrier.page.locator(`[data-testid="library-row"][data-arxiv="${scanned}"]`)).toBeVisible({ timeout: 15_000 })
})

test('the library shows a failed paper as failed, with Retry and no Mark finished', async ({ users }) => {
  test.setTimeout(150_000)
  // The conversion fails before anything is billed, so the request and the retry each give their slot back.
  const people = await users(['Schema cara', 'Schema ada'])
  let page = people[0].page
  let before = 0
  for (const p of people) {
    before = await allowanceLeft(p.page)
    page = p.page
    if (before > 0) break
  }
  test.skip(before === 0, 'Cara and Ada are at the daily cap in this local state')
  await calm(page)
  const id = await newFixtureId(page, '77')
  await analyzeUntilFailed(page, id, 'Fixture conversion failure')
  await page.goto('/library')
  const row = page.locator('[data-testid="library-row"]').filter({ hasText: `arXiv ${id}` })
  await expect(row).toHaveAttribute('data-paper-status', 'failed', { timeout: 15_000 })
  await expect(row.getByTestId('library-failed')).toHaveText('Analysis failed')
  await expect(row.getByTestId('library-known')).toHaveCount(0)
  await expect(row.getByTestId('library-finish')).toHaveCount(0)
  // Rows are separate grids; the failure sits in the same column as other rows' counts.
  const counts = page.getByTestId('library-known').first()
  if (await counts.count()) {
    const [a, b] = [await row.getByTestId('library-failed').boundingBox(), await counts.boundingBox()]
    expect(Math.round(a!.x)).toBe(Math.round(b!.x))
  }
  // Retry goes through the paper window's retry action; this fixture fails again and gives the slot back.
  const retried = page.waitForResponse((r) => r.url().endsWith('/api/actions/retryPaper'))
  await row.getByTestId('library-retry').click()
  expect((await (await retried).json()).success).toBe(true)
  // The fixture retries once inside the job (3 s), so the row shows the run before it fails again.
  await expect(row).toHaveAttribute('data-paper-status', /queued|processing/, { timeout: 15_000 })
  await expect(row.getByTestId('library-analyzing')).toHaveText('Analyzing…')
  await expect(row).toHaveAttribute('data-paper-status', 'failed', { timeout: READY_TIMEOUT })
  await expect(row.getByTestId('library-finish')).toHaveCount(0)
  expect(await allowanceLeft(page)).toBe(before)
})

test('the sidebar\'s New papers today comes back on its own after a refunded failure', async ({ users }) => {
  test.setTimeout(120_000)
  // The conversion fails before anything is billed, so the slot is only borrowed.
  const people = await users(['Schema cara', 'Schema ada'])
  let page = people[0].page
  let before = 0
  for (const p of people) {
    before = await allowanceLeft(p.page)
    page = p.page
    if (before > 0) break
  }
  test.skip(before === 0, 'Cara and Ada are at the daily cap in this local state')
  await calm(page)
  const sidebar = page.getByTestId('sidebar-allowance')
  await openFromHome(page, await newFixtureId(page, '77'))
  await expect(sidebar).toHaveAttribute('data-remaining', String(before - 1), { timeout: 15_000 })
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'failed', { timeout: READY_TIMEOUT })
  // No reload and no refocus: the paper turning failed refreshes the count.
  await expect(sidebar).toHaveAttribute('data-remaining', String(before), { timeout: 10_000 })
})

test('at the daily cap the Add window says so up front and lets only analyzed papers through', async ({ users }) => {
  test.setTimeout(150_000)
  const [dana] = await users(['Schema dana'])
  const page = dana.page
  await calm(page)
  await page.goto('/home')
  // The actions spec leaves Dana at her cap; use up anything left with fixture papers.
  for (let i = 0; i < 6; i++) {
    const left = await action(page, 'myAllowance', {})
    if (left.data.analyze.remaining === 0) break
    await action(page, 'analyzePaper', { input: await newFixtureId(page, '') })
  }
  await page.reload()
  await page.getByTestId('add-open').click()
  await page.getByTestId('add-choice-paper').click()
  const status = page.getByTestId('add-paper-status')
  const submit = page.getByTestId('add-paper-submit')

  await page.getByTestId('add-paper-input').fill(await newFixtureId(page, ''))
  await page.getByTestId('add-paper-lookup').click()
  await expect(status).toContainText("You've reached today's limit of 5 new papers.")
  // The time it opens up again is in the reader's own time, not UTC.
  await expect(status).toContainText(/after \d{1,2}:\d{2}/)
  await expect(status).not.toContainText('UTC')
  await expect(submit).toBeDisabled()

  // A paper someone already analyzed stays free to add.
  await page.getByTestId('add-paper-input').fill(FIXTURE_ID)
  await page.getByTestId('add-paper-lookup').click()
  await expect(status).toContainText('Already analyzed')
  await expect(submit).toBeEnabled()
})

test('Home\'s paper box goes through the Add window, which stops a sixth new paper at the daily cap', async ({ users }) => {
  test.setTimeout(150_000)
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  let refused = false
  for (let i = 0; i < 6 && !refused; i++) {
    // The window reads the allowance the sidebar loads.
    await allowanceLeft(page)
    await page.getByTestId('analyze-input').fill(await newFixtureId(page, ''))
    await page.getByTestId('analyze-submit').click()
    const dialog = page.getByTestId('add-dialog')
    await expect(dialog.getByTestId('add-paper-preview')).toBeVisible({ timeout: 15_000 })
    const status = dialog.getByTestId('add-paper-status')
    if (((await status.textContent()) ?? '').includes("You've reached today's limit")) {
      refused = true
      await expect(dialog.getByTestId('add-paper-submit')).toBeDisabled()
      // A new paper never opens without a workspace.
      await expect(dialog.getByTestId('dest-none')).toHaveCount(0)
      break
    }
    await expect(status).toContainText('analysis takes 1 to 2 minutes')
    await dialog.getByTestId('dest-new').check()
    await dialog.getByTestId('dest-name').fill(`[fixture] Cap ${Date.now()}`)
    await dialog.getByTestId('add-paper-submit').click()
    await page.waitForURL(/\/p\//, { timeout: 15_000 })
  }
  expect(refused).toBe(true)
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
  // c3 has no cached explanation, so generating one asks for sign-in: once, in the panel header, not on each card.
  await openBranch(page, 'geometry')
  const panel = page.getByTestId('branch-panel')
  await expect(panel.getByTestId('explain-signin')).toHaveCount(1)
  await expect(panel.getByTestId('explain-signin')).toHaveText('Sign in to generate an AI explanation')
  await expect(panel.getByTestId('branch-concepts').getByTestId('explain-signin')).toHaveCount(0)
})

test('signed out, the first visit opens the overview with focus on its heading; Tab, Shift+Tab and Esc still work', async ({ page }) => {
  // Static graph, but without calm(): the overview has to open on its own.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/p/${FIXTURE_SLUG}`)
  const win = page.getByTestId('overview-window')
  await expect(win).toBeVisible({ timeout: 20_000 })
  const heading = win.locator('#overview-window-title')
  await expect(heading).toBeFocused()
  // Programmatic focus draws no ring on the heading, and the close button has none either.
  expect(await heading.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
  await expect(win.getByTestId('panel-close')).not.toBeFocused()
  // The heading is not in the Tab order: Tab goes to the close button, and Shift+Tab from there wraps to the last control.
  await page.keyboard.press('Tab')
  await expect(win.getByTestId('panel-close')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(win.getByTestId('overview-start')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(win).toHaveCount(0)
})

test('signed out, the sign-in window over a branch takes focus and Esc, then gives focus back', async ({ page }) => {
  await calm(page)
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await openBranch(page, 'geometry')
  const trigger = page.getByTestId('branch-panel').getByTestId('explain-signin')
  await trigger.click()
  const signIn = page.getByTestId('sign-in-window')
  await expect(signIn.getByTestId('auth-overlay')).toBeVisible()
  const focusInside = () => signIn.evaluate((el) => el.contains(document.activeElement))
  await expect.poll(focusInside).toBe(true)
  // Tab cycles inside the sign-in window, never back into the panel behind it.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  expect(await focusInside()).toBe(true)

  // Esc closes only the window on top; the panel stays and focus is back on the button that opened sign-in.
  await page.keyboard.press('Escape')
  await expect(signIn).toHaveCount(0)
  await expect(page.getByTestId('branch-panel')).toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('branch-panel')).toHaveCount(0)
})

test('signed out, Save on a paper page opens the sign-in window and gives focus back', async ({ page }) => {
  await calm(page)
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  await expect(page.getByTestId('placement-open')).toHaveCount(0)
  const save = page.getByTestId('placement-signin')
  await expect(save).toHaveText('Save')
  await save.click()
  const signIn = page.getByTestId('sign-in-window')
  await expect(signIn.getByTestId('auth-overlay')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(signIn).toHaveCount(0)
  await expect(save).toBeFocused()
})

test('signed out, the demo page shows one Sign in, and the sign-in window names Schema', async ({ page }) => {
  await calm(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  const banner = page.getByTestId('demo-banner')
  await expect(banner.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByTestId('nav-sign-in-button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(1)
  // With the banner scrolled away, the top bar's Sign in comes back.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(banner).not.toBeInViewport()
  await expect(page.getByTestId('nav-sign-in-button')).toBeVisible()
  await page.getByTestId('nav-sign-in-button').click()
  const overlay = page.getByTestId('auth-overlay')
  await expect(overlay).toContainText('Sign in to Schema')
  await expect(overlay).not.toContainText('Sign in to DeepSpace')
  // The wrapper (zero-size around the SDK's fixed overlay) names the dialog for screen readers.
  await expect(page.getByRole('dialog', { name: 'Sign in to Schema' })).toHaveCount(1)
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

test('the mobile menu takes focus, closes on Esc and gives focus back to the menu button', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home')
  const menuButton = page.getByRole('button', { name: 'Open menu' })
  await menuButton.click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu).toBeVisible()
  await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(menuButton).toBeFocused()
})

test('the account menu closes on Esc and on a click outside, and in the phone menu Esc closes it before the sheet', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  const button = page.getByRole('button', { name: 'Account menu' })
  const menu = page.getByTestId('account-menu')
  await button.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  await button.click()
  await expect(menu).toBeVisible()
  await page.getByText('Recently analyzed', { exact: true }).click()
  await expect(menu).toHaveCount(0)
  // A click on the button itself still toggles it.
  await button.click()
  await expect(menu).toBeVisible()
  await button.click()
  await expect(menu).toHaveCount(0)

  // In the phone menu sheet, Esc closes the account menu first, then the sheet.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open menu' }).click()
  const sheet = page.getByRole('dialog', { name: 'Menu' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Account menu' }).click()
  await expect(sheet.getByTestId('account-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet.getByTestId('account-menu')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('recent papers in the sidebar carry the full title and arXiv id as a tooltip', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await calm(page)
  // Opening the paper puts it at the top of Recent papers.
  await page.goto(`/p/${FIXTURE_SLUG}`)
  await expect(page.getByTestId('paper-page')).toHaveAttribute('data-paper-status', 'ready', { timeout: 20_000 })
  // Fixture papers share a title, so the tooltip's arXiv id is what tells their rows apart.
  const row = page.getByTestId('sidebar-recent').locator(`a[href="/p/${FIXTURE_SLUG}"]`)
  await expect(row).toHaveText(FIXTURE_TITLE)
  await expect(row).toHaveAttribute('title', `${FIXTURE_TITLE} (arXiv ${FIXTURE_ID})`)
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
