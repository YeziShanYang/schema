/**
 * Request-level specs for the Add-flow actions, signed in as a test account.
 * Integrations are mocked by the fixtures (fixture ids start with "0000.",
 * fixture workspaces with "[fixture]").
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test.skip(loadAllTestAccounts().length < 1, 'Needs a test account.')
test.describe.configure({ mode: 'serial' })

async function call(page: Page, name: string, params: Record<string, unknown>) {
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

test('peekPaper looks a paper up without analyzing it', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home')
  const r = await call(ada.page, 'peekPaper', { input: 'https://arxiv.org/abs/0000.00001' })
  expect(r.success).toBe(true)
  expect(r.data).toMatchObject({
    arxivId: '0000.00001',
    title: 'A Fixture Paper on Curvature-Aware Attention',
    primaryCategory: 'cs.LG',
    categoryName: 'Machine Learning',
    suggestedWorkspaceName: 'Machine Learning',
    year: '2026',
  })
  expect(typeof r.data.analyzed).toBe('boolean')

  const bad = await call(ada.page, 'peekPaper', { input: 'not a paper' })
  expect(bad.success).toBe(false)
  expect(bad.error).toContain('does not look like an arXiv link')
})

test('analyzePaper with newWorkspace creates the workspace only for a valid paper', async ({ users }) => {
  const [, bob] = await users(['Schema ada', 'Schema bob'])
  const page = bob.page
  await page.goto('/home')
  const sidebar = page.getByTestId('sidebar-workspaces')
  await expect(sidebar).toBeVisible()
  const name = `[fixture] From a paper ${Date.now()}`

  const bad = await call(page, 'analyzePaper', { input: 'nonsense', newWorkspace: { name } })
  expect(bad.success).toBe(false)
  const empty = await call(page, 'analyzePaper', { input: '0000.00001', newWorkspace: { name: '  ' } })
  expect(empty.success).toBe(false)
  await page.reload()
  await expect(page.getByTestId('sidebar-workspaces')).not.toContainText(name)

  const ok = await call(page, 'analyzePaper', { input: '0000.00001', newWorkspace: { name } })
  expect(ok.success).toBe(true)
  expect(ok.data.workspaceId).toBeTruthy()
  await page.goto(`/w/${ok.data.workspaceId}`)
  await expect(page.getByTestId('workspace-name')).toHaveText(name)
  await expect(page.locator('[data-testid="workspace-paper"][data-arxiv="0000.00001"]')).toBeVisible()

  // Starter and next recommendation modes both answer (mocked search and ranking).
  const starter = await call(page, 'recommendPapers', { workspaceId: ok.data.workspaceId, mode: 'starter' })
  expect(starter.success).toBe(true)
  expect(starter.data.suggestions.length).toBe(2)
  const next = await call(page, 'recommendPapers', { workspaceId: ok.data.workspaceId, mode: 'next' })
  expect(next.success).toBe(true)
})

function newFixtureId(): string {
  for (;;) {
    const id = `0000.${String(10000 + Math.floor(Math.random() * 89990))}`
    if (!id.endsWith('99') && !id.endsWith('77')) return id
  }
}

test('parallel new papers never get past the daily cap', async ({ users }) => {
  test.setTimeout(90_000)
  const [dana] = await users(['Schema dana'])
  const page = dana.page
  await page.goto('/home')
  const before = await call(page, 'myAllowance', {})
  expect(before.success).toBe(true)
  const left: number = before.data.analyze.remaining
  const results = await Promise.all(Array.from({ length: left + 3 }, () => call(page, 'analyzePaper', { input: newFixtureId() })))
  expect(results.filter((r) => r.success)).toHaveLength(left)
  for (const r of results.filter((x) => !x.success)) expect(r.error).toContain('daily limit')
  const after = await call(page, 'myAllowance', {})
  expect(after.data.analyze.remaining).toBe(0)
})

test('parallel adds to one workspace keep every paper', async ({ users }) => {
  test.setTimeout(120_000)
  const [cara] = await users(['Schema cara'])
  const page = cara.page
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/home')
  // Fixed fixture ids: they cost a slot only the first time, then they are cached.
  const ids = ['0000.00021', '0000.00022', '0000.00023']
  for (const id of ids) {
    const r = await call(page, 'analyzePaper', { input: id })
    test.skip(!r.success, `Could not prepare ${id}: ${r.error}`)
  }
  const first = await call(page, 'analyzePaper', { input: ids[0], newWorkspace: { name: `[fixture] Parallel adds ${Date.now()}` } })
  expect(first.success).toBe(true)
  const workspaceId = first.data.workspaceId
  const adds = await Promise.all(ids.slice(1).map((id) => call(page, 'analyzePaper', { input: id, workspaceId })))
  expect(adds.every((r) => r.success)).toBe(true)
  // Adding one again does not duplicate it.
  expect((await call(page, 'analyzePaper', { input: ids[1], workspaceId })).success).toBe(true)

  await page.goto(`/w/${workspaceId}`)
  await expect(page.getByTestId('workspace-paper')).toHaveCount(3, { timeout: 20_000 })
})

test('reanalyzePaper refuses anyone but the app owner and leaves the paper as it was', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  const page = ada.page
  await page.goto('/home')
  const before = await call(page, 'peekPaper', { input: '0000.00001' })
  const r = await call(page, 'reanalyzePaper', { arxivId: '0000.00001' })
  expect(r.success).toBe(false)
  expect(r.error).toContain('Only the app owner')
  const after = await call(page, 'peekPaper', { input: '0000.00001' })
  expect(after.data.status).toBe(before.data.status)
})
