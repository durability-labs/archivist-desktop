import { test, expect, chromium, type Page } from '@playwright/test';

/**
 * Torrents page UI smoke tests — Vite-only fallback.
 *
 * These tests launch Chromium directly against the Vite dev server
 * (http://localhost:1420) rather than connecting over CDP to WebView2.
 * Tauri IPC calls will fail, but we verify all UI structure renders
 * without "Command not found" crashes.
 */

const VITE_URL = 'http://localhost:1420';

/** Navigate to a route with onboarding bypassed. */
async function gotoWithBypass(page: Page, path: string): Promise<void> {
  await page.goto(VITE_URL, { waitUntil: 'commit' });
  await page.evaluate(() => {
    localStorage.setItem('archivist_onboarding_complete', 'true');
  });
  await page.goto(`${VITE_URL}${path}`, { waitUntil: 'networkidle' });
}

test.describe('Torrents page UI', () => {
  test('should navigate to Torrents page via sidebar', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      // Torrents nav link should be visible in sidebar
      const navLink = page.locator('.sidebar .nav-link:has-text("Torrents")');
      await expect(navLink).toBeVisible({ timeout: 10_000 });

      // Click to navigate
      await navLink.click();
      await page.waitForLoadState('networkidle');

      // Page should render (may show loading or full state)
      const torrentsPage = page.locator('.torrents-page');
      await expect(torrentsPage).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('/torrents renders with correct header', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/torrents');

      const header = page.locator('.torrents-page h1');
      await expect(header).toHaveText('Torrents', { timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('/torrents shows global speed stats', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/torrents');
      await expect(page.locator('.torrents-page h1')).toBeVisible({ timeout: 10_000 });

      // Wait for loading state to pass (invoke will fail quickly)
      await page.waitForTimeout(2000);

      // Global stats should be visible with DL/UL speed indicators
      const dlSpeed = page.locator('.global-stats .dl-speed');
      const ulSpeed = page.locator('.global-stats .ul-speed');
      await expect(dlSpeed).toBeVisible({ timeout: 5_000 });
      await expect(ulSpeed).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('/torrents shows add-torrent bar with magnet input', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/torrents');
      await expect(page.locator('.torrents-page h1')).toBeVisible({ timeout: 10_000 });

      // Wait for loading to finish
      await page.waitForTimeout(2000);

      // Add torrent bar with magnet input and file button
      const magnetInput = page.locator('.add-torrent-bar input[type="text"]');
      await expect(magnetInput).toBeVisible({ timeout: 5_000 });
      await expect(magnetInput).toHaveAttribute('placeholder', /magnet/i);

      const addFileBtn = page.locator('.add-torrent-bar .add-file-btn');
      await expect(addFileBtn).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('/torrents shows empty state (no Tauri IPC = no torrents)', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/torrents');
      await expect(page.locator('.torrents-page h1')).toBeVisible({ timeout: 10_000 });

      // Wait for loading to finish
      await page.waitForTimeout(2000);

      // Empty state should be visible since we have no session stats
      const emptyState = page.locator('.torrent-empty-state');
      await expect(emptyState).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('/torrents shows status bar with speed limit inputs', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/torrents');
      await expect(page.locator('.torrents-page h1')).toBeVisible({ timeout: 10_000 });

      // Wait for loading to finish
      await page.waitForTimeout(2000);

      // Status bar with speed limit inputs
      const statusBar = page.locator('.torrent-status-bar');
      await expect(statusBar).toBeVisible({ timeout: 5_000 });

      const dlLimit = page.locator('.speed-limit-dl input');
      await expect(dlLimit).toBeVisible();

      const ulLimit = page.locator('.speed-limit-ul input');
      await expect(ulLimit).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('/torrents — no JS errors crash the page', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    try {
      await gotoWithBypass(page, '/torrents');
      await expect(page.locator('.torrents-page h1')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(3000);

      // The page should not have any "Command not found" errors
      const commandNotFound = consoleErrors.filter(e =>
        e.includes('Command') && e.includes('not found')
      );
      expect(commandNotFound).toHaveLength(0);

      // The torrents-page div should still be in the DOM (no React error boundary crash)
      await expect(page.locator('.torrents-page')).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
