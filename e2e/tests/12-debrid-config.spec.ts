import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateToStreamingTab,
  SEL,
} from '../helpers';

test.describe('Debrid Configuration', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should show debrid settings on Settings tab', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');

      await expect(page.locator('text=Debrid Service')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show provider selector with Real-Debrid and Premiumize options', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');

      const select = page.locator(SEL.debridProviderSelect);
      await expect(select).toBeVisible();

      // Check options
      const options = select.locator('option');
      const texts = await options.allTextContents();
      expect(texts).toContain('None');
      expect(texts).toContain('Real-Debrid');
      expect(texts).toContain('Premiumize');
    } finally {
      await browser.close();
    }
  });

  test('should show token input field when provider selected', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');

      // Select Real-Debrid
      await page.locator(SEL.debridProviderSelect).selectOption('real_debrid');
      await page.waitForTimeout(300);

      // Token input should appear
      await expect(page.locator(SEL.debridTokenInput)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should have Configure button disabled when no token entered', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');

      await page.locator(SEL.debridProviderSelect).selectOption('real_debrid');
      await page.waitForTimeout(300);

      await expect(page.locator(SEL.debridValidateBtn)).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('should enable Configure button when token entered', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');

      await page.locator(SEL.debridProviderSelect).selectOption('real_debrid');
      await page.waitForTimeout(300);

      await page.locator(SEL.debridTokenInput).fill('test-api-token');
      await page.waitForTimeout(200);

      await expect(page.locator(SEL.debridValidateBtn)).toBeEnabled();
    } finally {
      await browser.close();
    }
  });

  test('should clear provider configuration', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'settings');
      await page.waitForTimeout(500);

      // If provider is already configured, clear it
      const hasClearBtn = await page.locator(SEL.debridClearBtn).isVisible().catch(() => false);
      if (hasClearBtn) {
        await page.locator(SEL.debridClearBtn).click();
        await page.waitForTimeout(500);

        // After clearing, provider select should be enabled (not in configured state)
        await expect(page.locator(SEL.debridProviderSelect)).toBeEnabled();
      }
    } finally {
      await browser.close();
    }
  });
});
