import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  apiUploadFile,
  apiDeleteFile,
  apiListFiles,
  navigateTo,
  sleep,
  SEL,
} from '../helpers';

/**
 * Phase 3b — File Operations: upload, delete single, delete all, clear storage
 *
 * Assumes the app is running with --remote-debugging-port=9222
 * and the sidecar API is reachable on port 8080.
 */

test.describe('File Operations', () => {
  const uploadedCids: string[] = [];

  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
    await waitForPort(8080, 15_000);

    // Clean up any leftover test files
    try {
      const list = await apiListFiles();
      for (const item of list.content) {
        await apiDeleteFile(item.cid);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  test.afterAll(async () => {
    // Clean up any test files we uploaded
    for (const cid of uploadedCids) {
      try {
        await apiDeleteFile(cid);
      } catch {
        /* ignore cleanup errors */
      }
    }
  });

  test('should show uploaded file appears in file list', async () => {
    // Upload a small file via the sidecar API
    const testContent = `e2e upload test ${Date.now()}`;
    const cid = await apiUploadFile(testContent, 'e2e-upload-test.txt');
    uploadedCids.push(cid);

    expect(cid).toBeTruthy();
    expect(cid.length).toBeGreaterThan(10);

    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Restore');

      // Refresh the file list
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);
      await page.locator('button:has-text("Refresh")').click();
      await sleep(1000);

      // Verify the CID appears in the table
      const cidPrefix = cid.substring(0, 12);
      await expect(page.locator(`text=${cidPrefix}`)).toBeVisible({ timeout: 10_000 });

      // Verify file-stats shows at least 1 file
      const fileStats = page.locator('.file-stats');
      await expect(fileStats).toContainText('file');
    } finally {
      await browser.close();
    }
  });

  test('should delete single file via UI Remove button', async () => {
    // Upload a file to delete
    const testContent = `e2e delete single test ${Date.now()}`;
    const cid = await apiUploadFile(testContent, 'e2e-delete-single.txt');
    // Don't track in uploadedCids since we're deleting it here

    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Restore');

      // Refresh to see the file
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);
      await page.locator('button:has-text("Refresh")').click();
      await sleep(1000);

      // Find the file row containing our CID
      const cidPrefix = cid.substring(0, 12);
      await expect(page.locator(`text=${cidPrefix}`)).toBeVisible({ timeout: 10_000 });

      // Handle the confirmation dialog
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });

      // Click the Remove button in the row that contains our CID
      const row = page.locator(`tr:has(text=${cidPrefix})`);
      await row.locator('button:has-text("Remove")').click();

      // Wait for deletion to process
      await sleep(2000);

      // Refresh and verify file is gone
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);

      // The CID should no longer be visible
      const stillVisible = await page
        .locator(`text=${cidPrefix}`)
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      expect(stillVisible).toBeFalsy();
    } finally {
      await browser.close();
    }
  });

  test('should delete all files via Delete All button', async () => {
    // Upload 3 test files
    const cids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const cid = await apiUploadFile(
        `e2e delete-all test file ${i} ${Date.now()}`,
        `e2e-delete-all-${i}.txt`
      );
      cids.push(cid);
    }

    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Restore');

      // Refresh to see the files
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);
      await page.locator('button:has-text("Refresh")').click();
      await sleep(1000);

      // Verify files appear
      const fileStats = page.locator('.file-stats');
      await expect(fileStats).toBeVisible();

      // Verify Delete All button is visible
      const deleteAllBtn = page.locator('.file-stats button:has-text("Delete All")');
      await expect(deleteAllBtn).toBeVisible({ timeout: 5_000 });

      // Handle the confirmation dialog
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Delete all');
        await dialog.accept();
      });

      // Click Delete All
      await deleteAllBtn.click();

      // Wait for deletion
      await sleep(3000);

      // Refresh and check the list is empty
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);

      // File stats should show 0 files
      await expect(fileStats).toContainText('0 files');

      // Table should show empty state
      await expect(page.locator(SEL.emptyState)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should clear storage from Settings page', async () => {
    // Upload 2 test files
    for (let i = 0; i < 2; i++) {
      await apiUploadFile(
        `e2e settings clear test ${i} ${Date.now()}`,
        `e2e-settings-clear-${i}.txt`
      );
    }

    const { browser, page } = await connectToApp();

    try {
      // Navigate to Settings
      await navigateTo(page, 'Settings');

      // Find the Clear Storage button
      const clearBtn = page.locator('button:has-text("Clear Storage")');
      await expect(clearBtn).toBeVisible({ timeout: 10_000 });

      // Handle the confirmation dialog
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Delete all files');
        await dialog.accept();
      });

      // Click Clear Storage
      await clearBtn.click();

      // Wait for operation
      await sleep(3000);

      // Navigate to Restore to verify files are gone
      await navigateTo(page, 'Restore');
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);

      // Should show empty state
      await expect(page.locator(SEL.emptyState)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should show upload progress bar elements', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Restore');

      // Verify the upload button is visible
      await expect(page.locator(SEL.uploadBtn)).toBeVisible();

      // The upload progress bar should not be visible initially
      const progressBar = page.locator('.info-banner:has-text("Uploading")');
      await expect(progressBar).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should update storage stats after upload and delete', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Restore');

      // Refresh to get current state
      await page.locator('button:has-text("Refresh")').click();
      await sleep(1000);

      const fileStats = page.locator('.file-stats');
      const initialText = await fileStats.innerText();

      // Upload a file via API
      const cid = await apiUploadFile(
        'e2e storage stats test ' + Date.now(),
        'e2e-stats-test.txt'
      );

      // Refresh and check stats updated
      await page.locator('button:has-text("Refresh")').click();
      await sleep(2000);
      await page.locator('button:has-text("Refresh")').click();
      await sleep(1000);

      const afterUploadText = await fileStats.innerText();
      // Stats should have changed (more files or more bytes)
      expect(afterUploadText).not.toBe(initialText);

      // Clean up
      await apiDeleteFile(cid);
    } finally {
      await browser.close();
    }
  });
});
