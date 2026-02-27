import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Marketplace (Browse) page render tests.
 */
test.describe('Marketplace page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Browse page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Browse');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.marketplacePage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Browse');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.marketplaceHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show form and stats sections', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Browse');
      await page.waitForTimeout(500);

      // At least one section should exist
      const hasForm = await page.locator(SEL.mpForm).isVisible().catch(() => false);
      const hasStats = await page.locator(SEL.mpStats).isVisible().catch(() => false);
      const hasTable = await page.locator(SEL.mpTable).isVisible().catch(() => false);
      const hasEmpty = await page.locator(SEL.mpEmpty).isVisible().catch(() => false);

      expect(hasForm || hasStats || hasTable || hasEmpty).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show empty state or data table', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Browse');
      await page.waitForTimeout(500);

      const hasEmpty = await page.locator(SEL.mpEmpty).isVisible().catch(() => false);
      const hasTable = await page.locator(SEL.mpTable).isVisible().catch(() => false);

      // One of these should be visible
      expect(hasEmpty || hasTable).toBeTruthy();
    } finally {
      await browser.close();
    }
  });
});
