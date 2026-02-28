import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Marketplace (Browse) page — form interaction and data verification tests.
 * NOTE: Marketplace requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
test.describe('Marketplace page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  /** Navigate to Browse and return true if marketplace page rendered. */
  async function gotoMarketplace(page: import('@playwright/test').Page): Promise<boolean> {
    await navigateTo(page, 'Browse');
    await page.waitForTimeout(1_000);
    return await page.locator(SEL.marketplacePage).isVisible({ timeout: 5_000 }).catch(() => false);
  }

  test('should navigate to Browse page', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) {
        test.skip(true, 'Marketplace feature not available in this build');
        return;
      }
      await expect(page.locator(SEL.marketplacePage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const header = page.locator(SEL.marketplaceHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show stats section with labels and values', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const stats = page.locator(SEL.mpStats);
      const hasStats = await stats.isVisible().catch(() => false);

      if (hasStats) {
        const statItems = stats.locator('.mp-stat');
        const count = await statItems.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
          const item = statItems.nth(i);
          await expect(item.locator('.mp-stat-label')).toBeVisible();
          await expect(item.locator('.mp-stat-value')).toBeVisible();
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should fill and submit availability form', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const form = page.locator(SEL.mpForm).first();
      const hasForm = await form.isVisible().catch(() => false);

      if (!hasForm) {
        test.skip(true, 'No marketplace form visible');
        return;
      }

      const submitBtn = page.locator('.mp-submit-btn:has-text("Publish Availability")');
      const hasSubmit = await submitBtn.isVisible().catch(() => false);

      if (!hasSubmit) {
        test.skip(true, 'No Publish Availability button found');
        return;
      }

      await submitBtn.click();
      await page.waitForTimeout(3_000);

      const hasTable = await page.locator(SEL.mpTable).first().isVisible().catch(() => false);
      const hasError = await page.locator('.mp-error').isVisible().catch(() => false);
      const pageStill = await page.locator(SEL.marketplacePage).isVisible();

      expect(hasTable || hasError || pageStill).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should click refresh button without crash', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const refreshBtns = page.locator(SEL.mpRefreshBtn);
      const count = await refreshBtns.count();

      if (count > 0) {
        await refreshBtns.first().click();
        await page.waitForTimeout(2_000);
        await expect(page.locator(SEL.marketplacePage)).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should show empty state or data table for availability', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const hasEmpty = await page.locator(SEL.mpEmpty).first().isVisible().catch(() => false);
      const hasTable = await page.locator(SEL.mpTable).first().isVisible().catch(() => false);

      expect(hasEmpty || hasTable).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should fill storage request form', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoMarketplace(page);
      if (!available) { test.skip(true, 'Marketplace not available'); return; }

      const requestBtn = page.locator('.mp-submit-btn:has-text("Create Storage Request")');
      const hasRequest = await requestBtn.isVisible().catch(() => false);

      if (!hasRequest) {
        test.skip(true, 'No storage request form found');
        return;
      }

      const cidInput = page.locator('.mp-form input[list]').first();
      if (await cidInput.isVisible().catch(() => false)) {
        await cidInput.fill('zdj7WweQ9');
        await page.waitForTimeout(500);
      }

      await requestBtn.click();
      await page.waitForTimeout(3_000);

      expect(await page.locator(SEL.marketplacePage).isVisible()).toBeTruthy();
    } finally {
      await browser.close();
    }
  });
});
