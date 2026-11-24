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
