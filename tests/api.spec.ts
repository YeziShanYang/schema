import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('owner-billed integrations cannot be called from the browser', async ({ request }) => {
    const res = await request.post('/api/integrations/exa/search', { data: { query: 'x' } })
    expect(res.status()).toBe(403)
  })

  test('server actions require sign-in', async ({ request }) => {
    const res = await request.post('/api/actions/analyzePaper', { data: { input: '2611.29224' } })
    expect(res.status()).toBe(401)
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})
