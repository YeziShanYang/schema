import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Live checks against the deployed app with REAL integration calls (billed
 * to the app owner). Not part of `deepspace test run`; run on purpose:
 *
 *   LIVE_PAPER=2611.29224 npx playwright test -c tests/live/playwright.live.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.check.ts',
  timeout: 10 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'https://schema.app.space',
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
})
