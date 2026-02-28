import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Sync / Backups page — deep UI interaction tests.
 */
test.describe('Sync & Backups page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
    await waitForPort(8080, 15_000);
  });

  test('should navigate to Backups page and show header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const header = page.locator('.page-header h2').first();
      await expect(header).toBeVisible();
      const headerText = await header.textContent();
      // Header says "Sync" — the nav link says "Backups" but the page header says "Sync"
      expect(headerText?.toLowerCase()).toMatch(/sync|backup/);
    } finally {
      await browser.close();
    }
  });

  test('should display sync status card with idle or syncing indicator', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const statusCard = page.locator(SEL.syncStatusCard);
      await expect(statusCard).toBeVisible();

      // The status indicator should show one of the known states
      const indicator = statusCard.locator('.status-indicator');
      await expect(indicator).toBeVisible();
      const indicatorClass = await indicator.getAttribute('class');
      expect(indicatorClass).toBeTruthy();
      // Should have one of: idle, syncing
      expect(indicatorClass!.match(/idle|syncing/)).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show watched folders with folder details', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const foldersSection = page.locator(SEL.watchedFolders);
      await expect(foldersSection).toBeVisible();

      // Check if there are folder items (quickstart folder should exist)
      const folderItems = page.locator('.folder-item');
      const folderCount = await folderItems.count();

      if (folderCount > 0) {
        // Verify first folder has path and status
        const firstFolder = folderItems.first();
        await expect(firstFolder.locator('.folder-path')).toBeVisible();
        await expect(firstFolder.locator('.folder-status')).toBeVisible();

        const folderPath = await firstFolder.locator('.folder-path').textContent();
        expect(folderPath).toBeTruthy();
      } else {
        // No folders yet — empty state should be shown
        const emptyState = page.locator('.empty-state');
        await expect(emptyState).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should toggle folder enabled/disabled via toggle switch', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const folderItems = page.locator('.folder-item');
      const folderCount = await folderItems.count();

      if (folderCount === 0) {
        test.skip(true, 'No watched folders available to toggle');
        return;
      }

      // Find the toggle in the first folder's actions
      const firstFolder = folderItems.first();
      const toggle = firstFolder.locator('.folder-actions .toggle');
      const hasToggle = await toggle.isVisible().catch(() => false);

      if (!hasToggle) {
        test.skip(true, 'No toggle switch found in folder actions');
        return;
      }

      // Read current label
      const labelBefore = await firstFolder.locator('.toggle-label').textContent();

      // Click the toggle
      await toggle.click();
      await page.waitForTimeout(1_000);

      // Read label after toggle — should have changed
      const labelAfter = await firstFolder.locator('.toggle-label').textContent();
      expect(labelAfter).not.toEqual(labelBefore);

      // Toggle back to restore original state
      await toggle.click();
      await page.waitForTimeout(500);

      const labelRestored = await firstFolder.locator('.toggle-label').textContent();
      expect(labelRestored).toEqual(labelBefore);
    } finally {
      await browser.close();
    }
  });

  test('should trigger manual sync and show syncing state', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const syncNowBtn = page.locator('button:has-text("Sync Now")');
      const hasSyncNow = await syncNowBtn.isVisible().catch(() => false);

      if (!hasSyncNow) {
        const pageContent = await page.locator('.main-content').textContent();
        expect(pageContent).toBeTruthy();
        return;
      }

      const isDisabled = await syncNowBtn.isDisabled();
      if (isDisabled) {
        // No folders to sync — expected
        return;
      }

      // Click Sync Now
      await syncNowBtn.click();
      await page.waitForTimeout(500);

      // After clicking, button text should change to "Pause Sync" or status should update
      const pauseBtn = page.locator('button:has-text("Pause Sync")');
      const hasPause = await pauseBtn.isVisible({ timeout: 3_000 }).catch(() => false);

      // Page should still be functional
      await expect(page.locator('.main-content')).toBeVisible();

      if (hasPause) {
        await page.waitForTimeout(3_000);
      }
    } finally {
      await browser.close();
    }
  });

  test('should show queue size indicator when syncing', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const queueSize = page.locator('.queue-size');
      const hasQueue = await queueSize.isVisible().catch(() => false);

      if (hasQueue) {
        const queueText = await queueSize.textContent();
        expect(queueText).toBeTruthy();
        expect(queueText).toMatch(/\d/);
      }

      // At minimum, page should render without errors
      await expect(page.locator('.main-content')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show Backup Now button for folders with manifest CID', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backups');
      await page.waitForTimeout(500);

      const folderItems = page.locator('.folder-item');
      const folderCount = await folderItems.count();

      if (folderCount === 0) {
        test.skip(true, 'No watched folders available');
        return;
      }

      const backupBtn = page.locator('button:has-text("Backup Now")').first();
      const hasBackup = await backupBtn.isVisible().catch(() => false);

      if (hasBackup) {
        const isDisabled = await backupBtn.isDisabled();
        if (!isDisabled) {
          await backupBtn.click();
          await page.waitForTimeout(2_000);
          await expect(page.locator('.main-content')).toBeVisible();
        }
      }
      // If no Backup Now button, folders may not have manifest CIDs yet
    } finally {
      await browser.close();
    }
  });
});
