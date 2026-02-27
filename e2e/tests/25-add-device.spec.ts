import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Add Device page render and validation tests.
 */
test.describe('Add Device page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Add Device page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Add Device');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.addDevicePage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display peer address input', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Add Device');
      await page.waitForTimeout(500);

      const input = page.locator(SEL.peerAddressInput);
      await expect(input).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show error for invalid address', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Add Device');
      await page.waitForTimeout(500);

      const input = page.locator(SEL.peerAddressInput);
      await input.fill('not-a-valid-address');

      const connectBtn = page.locator(SEL.connectBtn);
      await connectBtn.click();
      await page.waitForTimeout(1_000);

      // Should show an error message
      const errorVisible = await page.locator(SEL.wizardError).isVisible().catch(() => false);
      const errorBanner = await page.locator('.error-message, .error-banner, .wizard-error').first().isVisible().catch(() => false);

      expect(errorVisible || errorBanner).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should handle empty submit gracefully', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Add Device');
      await page.waitForTimeout(500);

      // Clear the input
      const input = page.locator(SEL.peerAddressInput);
      await input.fill('');

      // The connect button should be disabled or clicking it should show validation
      const connectBtn = page.locator(SEL.connectBtn);
      const isDisabled = await connectBtn.isDisabled().catch(() => false);

      if (!isDisabled) {
        await connectBtn.click();
        await page.waitForTimeout(1_000);

        // Should show validation error or not navigate away
        await expect(page.locator(SEL.addDevicePage)).toBeVisible();
      } else {
        // Button correctly disabled for empty input
        expect(isDisabled).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });
});
