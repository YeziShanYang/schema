/**
 * Sign-in gating: /home requires an account, and every signed-out call to
 * action that promises sign-in opens the sign-in overlay. OAuth sign-in
 * returns to /home (see /api/auth/oauth-complete); a reader who arrives
 * signed in through the same link sees the home page with the flag dropped.
 */
import { test, expect } from 'deepspace/testing'

test('a signed-out visit to /home shows the sign-in prompt, not the page', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByTestId('signed-out-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('home-page')).toHaveCount(0)
  await expect(page.getByTestId('auth-overlay')).toHaveCount(0)
  await page.getByTestId('signed-out-sign-in').click()
  await expect(page.getByTestId('auth-overlay')).toBeVisible()
  // The window names Schema, not the platform.
  await expect(page.getByTestId('auth-overlay')).toContainText('Sign in to Schema')
  await expect(page.getByTestId('auth-overlay')).not.toContainText('Sign in to DeepSpace')
  await expect(page.getByTestId('auth-overlay')).toContainText('Continue with Google')
  await expect(page.getByTestId('auth-overlay')).toContainText('Continue with GitHub')
})

test('the landing calls to action open sign-in', async ({ page }) => {
  for (const id of ['landing-start', 'landing-sign-in']) {
    await page.goto('/')
    await page.getByTestId(id).click()
    await expect(page).toHaveURL(/\/home\?signin=1$/)
    await expect(page.getByTestId('auth-overlay')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('home-page')).toHaveCount(0)
  }
  // Closing the overlay leaves the prompt, which can reopen it.
  await page.getByTestId('auth-overlay-close').click()
  await expect(page.getByTestId('signed-out-panel')).toBeVisible()
})

test('signed out, the brand and the demo paper link lead back to the landing', async ({ page }) => {
  await page.goto('/home')
  await page.getByTestId('signed-out-demo-link').click()
  await expect(page).toHaveURL(/\/p\/1706~03762$/)
  await page.getByTestId('app-navigation').getByRole('link', { name: 'Schema' }).click()
  await expect(page.getByTestId('static-landing')).toBeVisible({ timeout: 15_000 })
})

test('signed in, the sign-in link lands on /home and drops the flag', async ({ users }) => {
  const [ada] = await users(['Schema ada'])
  await ada.page.goto('/home?signin=1')
  await expect(ada.page.getByTestId('home-page')).toBeVisible({ timeout: 15_000 })
  await expect(ada.page).toHaveURL(/\/home$/)
  await expect(ada.page.getByTestId('auth-overlay')).toHaveCount(0)
})
