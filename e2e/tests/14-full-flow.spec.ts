import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  navigateToStreamingTab,
  SEL,
  sleep,
} from '../helpers';

test.describe('Full Streaming Flow', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('full Stremio addon flow: install → browse → detail → cleanup', async () => {
    const { browser, page } = await connectToApp();
    try {
      // Step 1: Navigate to Addons tab
      await navigateToStreamingTab(page, 'addons');

      // Step 2: Install Cinemeta addon
      await page.locator(SEL.addonUrlInput).fill('https://v3-cinemeta.strem.io');
      await page.locator(SEL.addonInstallBtn).click();
      await page.waitForTimeout(5000);

      // Verify addon appears
      await expect(page.locator(SEL.addonItem)).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('text=Cinemeta')).toBeVisible();

      // Step 3: Switch to Discover → catalog loads
      await page.locator(SEL.tabDiscover).click();
      await page.waitForTimeout(3000);

      const hasCatalog = await page.locator(SEL.catalogGrid).isVisible().catch(() => false);
      if (hasCatalog) {
        // Step 4: Click first movie card → ContentDetail
        const firstCard = page.locator(SEL.catalogCard).first();
        await firstCard.click();
        await page.waitForTimeout(3000);

        // Step 5: Verify metadata
        await expect(page.locator(SEL.contentDetail)).toBeVisible({ timeout: 10_000 });
        const titleEl = page.locator(SEL.contentTitle);
        await expect(titleEl).toBeVisible({ timeout: 5000 });

        // Step 6: Go back to streaming
        await page.locator('.content-back-btn').click();
        await page.waitForTimeout(500);
      }

      // Step 7: Clean up - remove addon
      await page.locator(SEL.tabAddons).click();
      await page.waitForTimeout(500);

      const removeBtn = page.locator(SEL.addonRemoveBtn).first();
      if (await removeBtn.isVisible().catch(() => false)) {
        await removeBtn.click();
        await page.waitForTimeout(1000);
      }

      // Verify Discover shows empty state
      await page.locator(SEL.tabDiscover).click();
      await page.waitForTimeout(500);
      await expect(page.locator(SEL.catalogEmpty)).toBeVisible({ timeout: 5000 });
    } finally {
      await browser.close();
    }
  });

  test('IPTV tab: add input validation and UI state', async () => {
    const { browser, page } = await connectToApp();
    try {
      // Step 1: Navigate to IPTV tab
      await navigateToStreamingTab(page, 'iptv');

      // Step 2: Verify add button is disabled when empty
      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeDisabled();

      // Step 3: Fill in URL and name
      await page.locator(SEL.iptvPlaylistInput).fill('http://example.com/test.m3u');
      await page.locator(SEL.iptvPlaylistName).fill('Test List');

      // Step 4: Button should now be enabled
      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeEnabled();

      // Note: Actual playlist addition requires a real M3U URL
      // so we just verify the UI interaction works
    } finally {
      await browser.close();
    }
  });

  test('Debrid settings flow: select provider → enter token → clear', async () => {
    const { browser, page } = await connectToApp();
    try {
      // Step 1: Navigate to Settings tab
      await navigateToStreamingTab(page, 'settings');

      // Step 2: Select provider
      await page.locator(SEL.debridProviderSelect).selectOption('real_debrid');
      await page.waitForTimeout(300);

      // Step 3: Token input should appear
      await expect(page.locator(SEL.debridTokenInput)).toBeVisible();

      // Step 4: Configure button should be disabled without token
      await expect(page.locator(SEL.debridValidateBtn)).toBeDisabled();

      // Step 5: Enter token → button enables
      await page.locator(SEL.debridTokenInput).fill('test-token-123');
      await expect(page.locator(SEL.debridValidateBtn)).toBeEnabled();

      // Step 6: Reset to None
      // Note: We don't actually configure (would fail with invalid token)
      // Just verify the UI works correctly
      await page.locator(SEL.debridProviderSelect).selectOption('');
      await page.waitForTimeout(300);

      // Token input should disappear
      await expect(page.locator(SEL.debridTokenInput)).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
