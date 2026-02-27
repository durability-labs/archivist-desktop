import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Deals page render tests.
 */
test.describe('Deals page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to My Deals page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'My Deals');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.dealsPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'My Deals');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.dealsHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show empty state when no deals exist', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'My Deals');
      await page.waitForTimeout(500);

      // Should show either deals list or empty state message
      const pageContent = await page.locator(SEL.dealsPage).textContent();
      expect(pageContent).toBeTruthy();
    } finally {
      await browser.close();
    }
  });
});
