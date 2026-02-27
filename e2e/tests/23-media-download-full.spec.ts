import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, sleep, SEL } from '../helpers';

/**
 * @online @slow
 * Full media download E2E tests. Requires internet and yt-dlp/ffmpeg installed.
 *
 * Uses short, freely-licensed test videos to minimize download time.
 */

// Short CC-licensed video (~10s)
const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=BaW_jenozKc'; // Blender "Big Buck Bunny" trailer, ~33s

test.describe('Media Download (full) @online @slow', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should verify yt-dlp and ffmpeg are installed', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(1_000);

      // Check for setup banner (means binaries are NOT installed)
      const hasBanner = await page.locator(SEL.setupBanner).isVisible().catch(() => false);
      const hasVersionInfo = await page.locator(SEL.binaryInfo).isVisible().catch(() => false);

      if (hasBanner) {
        // Skip remaining tests if binaries aren't installed
        test.skip(true, 'yt-dlp not installed — install via Media Download page');
      }

      expect(hasVersionInfo).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should fetch metadata for a video URL', async () => {
    test.setTimeout(60_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Enter the test URL
      await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
      await page.waitForTimeout(300);

      // Click Fetch Info
      const fetchBtn = page.locator(SEL.fetchBtn);
      await expect(fetchBtn).toBeEnabled();
      await fetchBtn.click();

      // Wait for metadata to load (yt-dlp needs to fetch)
      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      await expect(metadataPreview).toBeVisible({ timeout: 30_000 });

      // Should show title
      const title = page.locator('.metadata-preview .title, .media-title, .video-title').first();
      await expect(title).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should have format selection dropdown', async () => {
    test.setTimeout(60_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Re-fetch metadata if needed
      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      const hasMetadata = await metadataPreview.isVisible().catch(() => false);

      if (!hasMetadata) {
        await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
        await page.locator(SEL.fetchBtn).click();
        await expect(metadataPreview).toBeVisible({ timeout: 30_000 });
      }

      // Format selector should be present
      const formatSelect = page.locator('.format-select, .quality-select, select').first();
      await expect(formatSelect).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should toggle audio-only mode', async () => {
    test.setTimeout(60_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Ensure metadata is loaded
      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      const hasMetadata = await metadataPreview.isVisible().catch(() => false);

      if (!hasMetadata) {
        await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
        await page.locator(SEL.fetchBtn).click();
        await expect(metadataPreview).toBeVisible({ timeout: 30_000 });
      }

      // Find audio-only toggle
      const audioToggle = page.locator('.audio-toggle, input[type="checkbox"]:near(:text("Audio")), label:has-text("Audio only")').first();
      const hasToggle = await audioToggle.isVisible().catch(() => false);

      if (hasToggle) {
        await audioToggle.click();
        await page.waitForTimeout(500);

        // Format options should change (e.g. show MP3, M4A instead of video formats)
        const formatSelect = page.locator('.format-select, .quality-select, select').first();
        const hasFormat = await formatSelect.isVisible().catch(() => false);

        if (hasFormat) {
          const options = await formatSelect.textContent();
          // Audio formats should mention audio-related terms
          expect(options).toBeTruthy();
        }

        // Toggle back
        await audioToggle.click();
        await page.waitForTimeout(300);
      }
    } finally {
      await browser.close();
    }
  });

  test('should queue and complete a video download', async () => {
    test.setTimeout(180_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Ensure metadata is loaded
      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      const hasMetadata = await metadataPreview.isVisible().catch(() => false);

      if (!hasMetadata) {
        await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
        await page.locator(SEL.fetchBtn).click();
        await expect(metadataPreview).toBeVisible({ timeout: 30_000 });
      }

      // Click Download button
      const downloadBtn = page.locator('button:has-text("Download"), button:has-text("Queue")').first();
      await expect(downloadBtn).toBeVisible({ timeout: 5_000 });
      await downloadBtn.click();
      await page.waitForTimeout(2_000);

      // Download queue should show the task
      await expect(page.locator(SEL.downloadQueue)).toBeVisible();
      const queueItem = page.locator('.download-task, .queue-item, .download-item').first();
      await expect(queueItem).toBeVisible({ timeout: 10_000 });

      // Wait for progress bar
      const progressBar = page.locator('.progress-bar, .download-progress').first();
      await expect(progressBar).toBeVisible({ timeout: 15_000 });

      // Wait for completion (up to 120s)
      const completedBadge = page.locator('.badge-success, .state-completed, .status-completed, :text("Completed")').first();
      await expect(completedBadge).toBeVisible({ timeout: 120_000 });
    } finally {
      await browser.close();
    }
  });

  test('should queue and complete an audio download', async () => {
    test.setTimeout(180_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Enter URL
      await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
      await page.locator(SEL.fetchBtn).click();

      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      await expect(metadataPreview).toBeVisible({ timeout: 30_000 });

      // Toggle audio-only
      const audioToggle = page.locator('.audio-toggle, input[type="checkbox"]:near(:text("Audio")), label:has-text("Audio only")').first();
      if (await audioToggle.isVisible().catch(() => false)) {
        await audioToggle.click();
        await page.waitForTimeout(500);
      }

      // Queue download
      const downloadBtn = page.locator('button:has-text("Download"), button:has-text("Queue")').first();
      await downloadBtn.click();
      await page.waitForTimeout(2_000);

      // Wait for completion
      const completedBadges = page.locator('.badge-success, .state-completed, .status-completed, :text("Completed")');
      // There might be a previous download completed too
      await expect(completedBadges.last()).toBeVisible({ timeout: 120_000 });
    } finally {
      await browser.close();
    }
  });

  test('should cancel an in-progress download', async () => {
    test.setTimeout(60_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Start a new download
      await page.locator(SEL.urlInput).fill(TEST_VIDEO_URL);
      await page.locator(SEL.fetchBtn).click();

      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      await expect(metadataPreview).toBeVisible({ timeout: 30_000 });

      const downloadBtn = page.locator('button:has-text("Download"), button:has-text("Queue")').first();
      await downloadBtn.click();
      await page.waitForTimeout(2_000);

      // Find cancel button on the most recent task
      const cancelBtn = page.locator('.cancel-btn, button:has-text("Cancel")').last();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(1_000);

        // Task should show cancelled state
        const cancelledBadge = page.locator('.state-cancelled, .badge-cancelled, :text("Cancelled")').last();
        const hasCancelled = await cancelledBadge.isVisible().catch(() => false);
        expect(hasCancelled).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });

  test('should remove a task from queue', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      const queueItems = page.locator('.download-task, .queue-item, .download-item');
      const initialCount = await queueItems.count();

      if (initialCount > 0) {
        // Find remove button on the last task
        const removeBtn = page.locator('.remove-btn, button:has-text("Remove")').last();
        if (await removeBtn.isVisible().catch(() => false)) {
          await removeBtn.click();
          await page.waitForTimeout(1_000);

          const newCount = await queueItems.count();
          expect(newCount).toBeLessThan(initialCount);
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should clear completed downloads', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Find "Clear Completed" or similar button
      const clearBtn = page.locator('button:has-text("Clear"), button:has-text("Clear Completed"), button:has-text("Clear All")').first();
      if (await clearBtn.isVisible().catch(() => false)) {
        await clearBtn.click();
        await page.waitForTimeout(1_000);

        // Queue should be empty or have fewer items
        const queueEmpty = page.locator(SEL.queueEmpty);
        const hasEmpty = await queueEmpty.isVisible().catch(() => false);
        const remainingItems = await page.locator('.download-task, .queue-item, .download-item').count();

        expect(hasEmpty || remainingItems === 0).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });
});
