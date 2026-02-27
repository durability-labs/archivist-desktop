import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Archivist Desktop e2e tests.
 *
 * These tests connect to a running Archivist Desktop instance via CDP
 * (Chrome DevTools Protocol) exposed by WebView2 on port 9222.
 *
 * Prerequisites:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
 *   Then launch Archivist.exe
 *
 * Test tags:
 *   @smoke  — Fast single-instance tests (~3 min)
 *   @online — Requires internet (real yt-dlp downloads, torrents, web archiving)
 *   @slow   — Long downloads (>60s per test)
 *   @dual   — Requires a second app instance (CDP 9223, API 9080)
 *
 * Run by tag:
 *   npx playwright test --grep @smoke
 *   npx playwright test --grep @online
 *   npx playwright test --grep @dual
 *   npx playwright test --grep-invert @dual   (skip dual-instance tests)
 *   npx playwright test --grep-invert "@dual|@slow"  (fast local only)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // tests must run sequentially (shared app state)
  workers: 1,                  // single worker — all tests share one app instance
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  // No browser launch — we connect over CDP
  use: {
    // Intentionally empty: each test file connects via connectOverCDP
  },

  projects: [
    {
      name: 'archivist-cdp',
      testMatch: '**/*.spec.ts',
    },
  ],
});
