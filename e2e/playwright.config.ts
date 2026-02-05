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
