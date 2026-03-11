import { test, expect, chromium, type Page } from '@playwright/test';

/**
 * IRC Chat component UI smoke tests — Vite-only fallback.
 *
 * These tests launch Chromium directly against the Vite dev server
 * (http://localhost:1420). Tauri IPC calls will fail, but we verify
 * the IRC chat UI structure renders on the Dashboard.
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

test.describe('IRC Chat component UI', () => {
  test('IRC chat component renders in Dashboard', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const ircChat = page.locator('.irc-chat');
      await expect(ircChat).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('IRC header shows channel name #archivist', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const channel = page.locator('.irc-channel');
      await expect(channel).toBeVisible({ timeout: 10_000 });
      await expect(channel).toHaveText('#archivist');
    } finally {
      await browser.close();
    }
  });

  test('IRC status dot is present', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const dot = page.locator('.irc-dot');
      await expect(dot).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('IRC messages area is present', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const messages = page.locator('.irc-messages');
      await expect(messages).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('IRC input is present and disabled when not connected', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const input = page.locator('.irc-input');
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('IRC shows empty state text when not connected', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      const empty = page.locator('.irc-empty');
      await expect(empty).toBeVisible({ timeout: 10_000 });
      // Should show connecting or disconnected message
      const text = await empty.textContent();
      expect(
        text?.includes('Connecting to Libera.Chat') ||
        text?.includes('Click Connect')
      ).toBeTruthy();
    } finally {
      await browser.close();
    }
  });
});
