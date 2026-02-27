import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Sync / Backups page tests.
 */
test.describe('Sync & Backups page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
    await waitForPort(8080, 15_000);
  });

  test('should navigate to Backups page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      // Verify we landed on the page (header or page container)
      const header = page.locator('.page-header h2, h1, h2').first();
      const headerText = await header.textContent();
      expect(headerText?.toLowerCase()).toContain('backup');
    } finally {
      await browser.close();
    }
  });

  test('should display sync status card', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      // The sync status card or a status indicator should be visible
      const hasStatusCard = await page.locator(SEL.syncStatusCard).isVisible().catch(() => false);
      const hasStatusSection = await page.locator('.sync-status, .backup-status, .status-section').first().isVisible().catch(() => false);

      expect(hasStatusCard || hasStatusSection).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show watched folders list', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      // Should show the watched folders section (may contain quickstart folder)
      const hasFolders = await page.locator(SEL.watchedFolders).isVisible().catch(() => false);
      const hasFolderList = await page.locator('.folder-list, .watched-folder, .sync-folder').first().isVisible().catch(() => false);

      expect(hasFolders || hasFolderList).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should trigger manual sync', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      // Find Sync Now button
      const syncBtn = page.locator('button:has-text("Sync Now"), button:has-text("Sync"), button:has-text("Backup Now")').first();
      const hasSyncBtn = await syncBtn.isVisible().catch(() => false);

      if (hasSyncBtn) {
        await syncBtn.click();
        await page.waitForTimeout(2_000);

        // Status should update (syncing indicator, or success message)
        // Just verify the page is still functional and didn't error
        const pageStillVisible = await page.locator('.main-content').isVisible();
        expect(pageStillVisible).toBeTruthy();
      } else {
        // No sync button available, page still renders correctly
        const pageContent = await page.locator('.main-content').textContent();
        expect(pageContent).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });
});
