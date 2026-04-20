import { defineConfig } from '@playwright/test';

/**
 * Playwright config for tests that drive the REAL installed Archivist Desktop
 * app via Chrome DevTools Protocol (CDP). Unlike e2e/playwright/playwright.config.ts
 * (which targets Vite dev server), this config connects to the WebView2 inside
 * the running Tauri app — giving us real Tauri IPC, real sidecar, real disk.
 *
 * Driven by scripts/run-app-e2e.ps1 which:
 *   - Launches archivist-desktop.exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
 *     set to `--remote-debugging-port=9222`
 *   - Sets ARCHIVIST_CDP_URL and ARCHIVIST_NODE_LOG env vars for tests to read
 *   - Cleans up processes on exit
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000, // wallet setup + restart can take a while
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
