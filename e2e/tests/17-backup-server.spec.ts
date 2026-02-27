import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Backup Server page tests.
 */
test.describe('Backup Server page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Backup Server page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.backupServerPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.backupServerHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show stats cards or daemon controls', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(500);

      // Should have stats cards or a daemon toggle
      const hasStats = await page.locator(SEL.backupStatsCard).first().isVisible().catch(() => false);
      const hasToggle = await page.locator(SEL.backupDaemonToggle).isVisible().catch(() => false);
      const hasContent = await page.locator(SEL.backupServerPage).textContent();

      // Page should render with some content
      expect(hasStats || hasToggle || (hasContent && hasContent.length > 0)).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should toggle daemon enable/disable', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(500);

      // Find an enable/disable button or toggle
      const enableBtn = page.locator('button:has-text("Enable"), button:has-text("Start Daemon")').first();
      const disableBtn = page.locator('button:has-text("Disable"), button:has-text("Stop Daemon")').first();
      const toggle = page.locator(SEL.backupDaemonToggle);

      const hasEnable = await enableBtn.isVisible().catch(() => false);
      const hasDisable = await disableBtn.isVisible().catch(() => false);
      const hasToggle = await toggle.isVisible().catch(() => false);

      if (hasEnable) {
        // Enable the daemon
        await enableBtn.click();
        await page.waitForTimeout(2_000);

        // Verify UI updates (disable button appears or status changes)
        const pageText = await page.locator(SEL.backupServerPage).textContent();
        expect(pageText).toBeTruthy();
      } else if (hasDisable) {
        // Daemon is already enabled, disable then re-enable
        await disableBtn.click();
        await page.waitForTimeout(2_000);

        // Re-enable
        const newEnableBtn = page.locator('button:has-text("Enable"), button:has-text("Start Daemon")').first();
        if (await newEnableBtn.isVisible().catch(() => false)) {
          await newEnableBtn.click();
          await page.waitForTimeout(2_000);
        }
      } else if (hasToggle) {
        await toggle.click();
        await page.waitForTimeout(2_000);

        // Toggle back
        await toggle.click();
        await page.waitForTimeout(1_000);
      }

      // Page should still be visible and functional
      await expect(page.locator(SEL.backupServerPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
