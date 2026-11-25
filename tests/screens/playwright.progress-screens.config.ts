import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Screenshots of the analysis progress view on a local dev server, at 1440
 * and 390 widths, with and without --force-prefers-reduced-motion. Uses slow
 * fixture papers, so it needs a local runtime (`npx deepspace dev start`).
 * Not part of `test run`.
 *
 *   LOCAL_BASE_URL=http://127.0.0.1:5173 SHOTS_DIR=/tmp/shots \
 *     npx playwright test -c tests/screens/playwright.progress-screens.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'progress-screens.check.ts',
  timeout: 5 * 60_000,
  workers: 1,
  use: { baseURL: process.env.LOCAL_BASE_URL ?? 'http://127.0.0.1:5173', headless: true, launchOptions: chromiumLaunchOptions() },
})
