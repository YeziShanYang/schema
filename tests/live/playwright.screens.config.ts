import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Screenshots of every screen at 1440 and 390 widths, once normally and once
 * with Chrome's --force-prefers-reduced-motion. Not part of `test run`.
 *
 *   SHOTS_DIR=/tmp/shots npx playwright test -c tests/live/playwright.screens.config.ts
 */
const base = chromiumLaunchOptions()
export default defineConfig({
  testDir: '.',
  testMatch: 'screens.check.ts',
  timeout: 5 * 60_000,
  workers: 1,
  use: { baseURL: process.env.LIVE_BASE_URL ?? 'https://schema.app.space', headless: true, actionTimeout: 20_000 },
  projects: [
    { name: 'motion', use: { launchOptions: base } },
    // Playwright emulates no-preference unless told otherwise, so the flag alone is not enough.
    { name: 'reduced', use: { reducedMotion: 'reduce', launchOptions: { ...base, args: [...(base.args ?? []), '--force-prefers-reduced-motion'] } } },
  ],
})
