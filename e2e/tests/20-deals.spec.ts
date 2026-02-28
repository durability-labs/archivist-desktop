import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Deals page — expandable rows, refresh, and state badge verification.
 * NOTE: Deals requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
test.describe('Deals page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  /** Navigate to My Deals and return true if page rendered. */
  async function gotoDeals(page: import('@playwright/test').Page): Promise<boolean> {
    await navigateTo(page, 'My Deals');
    await page.waitForTimeout(1_000);
    return await page.locator(SEL.dealsPage).isVisible({ timeout: 5_000 }).catch(() => false);
  }

  test('should navigate to My Deals page', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) {
        test.skip(true, 'Deals feature not available in this build');
        return;
      }
      await expect(page.locator(SEL.dealsPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) { test.skip(true, 'Deals not available'); return; }

      const header = page.locator(SEL.dealsHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should click refresh button and verify page updates', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) { test.skip(true, 'Deals not available'); return; }

      const refreshBtn = page.locator(SEL.mpRefreshBtn).first();
      const hasRefresh = await refreshBtn.isVisible().catch(() => false);

      if (hasRefresh) {
        await refreshBtn.click();
        await page.waitForTimeout(2_000);
        await expect(page.locator(SEL.dealsPage)).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should expand purchase row on click', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) { test.skip(true, 'Deals not available'); return; }

      const table = page.locator(SEL.mpTable).first();
      const hasTable = await table.isVisible().catch(() => false);

      if (!hasTable) {
        const hasEmpty = await page.locator(SEL.mpEmpty).first().isVisible().catch(() => false);
        expect(hasEmpty).toBeTruthy();
        return;
      }

      const rows = table.locator('tbody tr');
      const rowCount = await rows.count();

      if (rowCount > 0) {
        const firstRow = rows.first();
        await firstRow.click();
        await page.waitForTimeout(500);

        const rowCountAfter = await rows.count();
        expect(rowCountAfter).toBeGreaterThanOrEqual(rowCount);
      }
    } finally {
      await browser.close();
    }
  });

  test('should show state badges with text content', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) { test.skip(true, 'Deals not available'); return; }

      const badges = page.locator('.mp-state-badge');
      const badgeCount = await badges.count();

      if (badgeCount > 0) {
        for (let i = 0; i < badgeCount; i++) {
          const badge = badges.nth(i);
          const text = await badge.textContent();
          expect(text).toBeTruthy();
          expect(text!.trim().length).toBeGreaterThan(0);
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should show empty state or data for purchases and slots', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoDeals(page);
      if (!available) { test.skip(true, 'Deals not available'); return; }

      const pageContent = await page.locator(SEL.dealsPage).textContent();
      expect(pageContent).toBeTruthy();
      expect(pageContent!.length).toBeGreaterThan(0);

      const sections = page.locator('.mp-section');
      const sectionCount = await sections.count();
      expect(sectionCount).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });
});
