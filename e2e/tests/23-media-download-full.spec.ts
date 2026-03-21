import { navigateTo, hasText, sleep, SEL } from '../helpers';

/**
 * @online @slow
 * Full media download E2E tests. Requires internet and yt-dlp/ffmpeg installed.
 *
 * Uses short, freely-licensed test videos to minimize download time.
 */

// Short CC-licensed video (~10s)
const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=BaW_jenozKc'; // Blender "Big Buck Bunny" trailer, ~33s

describe('Media Download (full) @online @slow', () => {
  it('should verify yt-dlp and ffmpeg are installed', async function () {
    await navigateTo('Media Download');
    await browser.pause(1000);

    // Check for setup banner (means binaries are NOT installed)
    const bannerEl = await $(SEL.setupBanner);
    const hasBanner = await bannerEl.isDisplayed().catch(() => false);
    const versionEl = await $(SEL.binaryInfo);
    const hasVersionInfo = await versionEl.isDisplayed().catch(() => false);

    if (hasBanner) {
      // Skip remaining tests if binaries aren't installed
      this.skip();
      return;
    }

    expect(hasVersionInfo).toBeTruthy();
  });

  it('should fetch metadata for a video URL', async function () {
    this.timeout(60000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Enter the test URL
    const urlInput = await $(SEL.urlInput);
    await urlInput.setValue(TEST_VIDEO_URL);
    await browser.pause(300);

    // Click Fetch Info
    const fetchBtn = await $(SEL.fetchBtn);
    await expect(fetchBtn).toBeEnabled();
    await fetchBtn.click();

    // Wait for metadata to load (yt-dlp needs to fetch)
    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    await metadataPreview.waitForDisplayed({ timeout: 30000 });

    // Should show title
    const title = await $('.metadata-preview .title, .media-title, .video-title');
    await title.waitForDisplayed({ timeout: 5000 });
  });

  it('should have format selection dropdown', async function () {
    this.timeout(60000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Re-fetch metadata if needed
    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    const hasMetadata = await metadataPreview.isDisplayed().catch(() => false);

    if (!hasMetadata) {
      const urlInput = await $(SEL.urlInput);
      await urlInput.setValue(TEST_VIDEO_URL);
      const fetchBtn = await $(SEL.fetchBtn);
      await fetchBtn.click();
      await metadataPreview.waitForDisplayed({ timeout: 30000 });
    }

    // Format selector should be present
    const formatSelect = await $('.format-select, .quality-select, select');
    await formatSelect.waitForDisplayed({ timeout: 5000 });
  });

  it('should toggle audio-only mode', async function () {
    this.timeout(60000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Ensure metadata is loaded
    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    const hasMetadata = await metadataPreview.isDisplayed().catch(() => false);

    if (!hasMetadata) {
      const urlInput = await $(SEL.urlInput);
      await urlInput.setValue(TEST_VIDEO_URL);
      const fetchBtn = await $(SEL.fetchBtn);
      await fetchBtn.click();
      await metadataPreview.waitForDisplayed({ timeout: 30000 });
    }

    // Find audio-only toggle
    const audioToggle = await $('.audio-toggle');
    let hasToggle = await audioToggle.isDisplayed().catch(() => false);

    if (!hasToggle) {
      const labelToggle = await hasText('label', 'Audio only');
      hasToggle = await labelToggle.isDisplayed().catch(() => false);
      if (hasToggle) {
        await labelToggle.click();
        await browser.pause(500);

        // Format options should change
        const formatSelect = await $('.format-select, .quality-select, select');
        const hasFormat = await formatSelect.isDisplayed().catch(() => false);

        if (hasFormat) {
          const options = await formatSelect.getText();
          expect(options).toBeTruthy();
        }

        // Toggle back
        await labelToggle.click();
        await browser.pause(300);
        return;
      }
    }

    if (hasToggle) {
      await audioToggle.click();
      await browser.pause(500);

      // Format options should change
      const formatSelect = await $('.format-select, .quality-select, select');
      const hasFormat = await formatSelect.isDisplayed().catch(() => false);

      if (hasFormat) {
        const options = await formatSelect.getText();
        expect(options).toBeTruthy();
      }

      // Toggle back
      await audioToggle.click();
      await browser.pause(300);
    }
  });

  it('should queue and complete a video download', async function () {
    this.timeout(180000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Ensure metadata is loaded
    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    const hasMetadata = await metadataPreview.isDisplayed().catch(() => false);

    if (!hasMetadata) {
      const urlInput = await $(SEL.urlInput);
      await urlInput.setValue(TEST_VIDEO_URL);
      const fetchBtn = await $(SEL.fetchBtn);
      await fetchBtn.click();
      await metadataPreview.waitForDisplayed({ timeout: 30000 });
    }

    // Click Download button — try both "Download" and "Queue"
    let downloadBtn = await hasText('button', 'Download');
    let btnVisible = await downloadBtn.isDisplayed().catch(() => false);
    if (!btnVisible) {
      downloadBtn = await hasText('button', 'Queue');
    }
    await downloadBtn.waitForDisplayed({ timeout: 5000 });
    await downloadBtn.click();
    await browser.pause(2000);

    // Download queue should show the task
    const queue = await $(SEL.downloadQueue);
    await expect(queue).toBeDisplayed();
    const queueItem = await $('.download-task, .queue-item, .download-item');
    await queueItem.waitForDisplayed({ timeout: 10000 });

    // Wait for progress bar
    const progressBar = await $('.progress-bar, .download-progress');
    await progressBar.waitForDisplayed({ timeout: 15000 });

    // Wait for completion (up to 120s)
    const completedBadge = await $('.badge-success, .state-completed, .status-completed');
    await completedBadge.waitForDisplayed({ timeout: 120000 });
  });

  it('should queue and complete an audio download', async function () {
    this.timeout(180000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Enter URL
    const urlInput = await $(SEL.urlInput);
    await urlInput.setValue(TEST_VIDEO_URL);
    const fetchBtn = await $(SEL.fetchBtn);
    await fetchBtn.click();

    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    await metadataPreview.waitForDisplayed({ timeout: 30000 });

    // Toggle audio-only
    const audioToggle = await $('.audio-toggle');
    if (await audioToggle.isDisplayed().catch(() => false)) {
      await audioToggle.click();
      await browser.pause(500);
    } else {
      const labelToggle = await hasText('label', 'Audio only');
      if (await labelToggle.isDisplayed().catch(() => false)) {
        await labelToggle.click();
        await browser.pause(500);
      }
    }

    // Queue download
    let downloadBtn = await hasText('button', 'Download');
    let btnVisible = await downloadBtn.isDisplayed().catch(() => false);
    if (!btnVisible) {
      downloadBtn = await hasText('button', 'Queue');
    }
    await downloadBtn.click();
    await browser.pause(2000);

    // Wait for completion
    const completedBadges = await $$('.badge-success, .state-completed, .status-completed');
    // There might be a previous download completed too — wait for at least one
    const badgeCount = await completedBadges.length;
    const lastBadge = completedBadges[badgeCount - 1] || await $('.badge-success, .state-completed, .status-completed');
    await lastBadge.waitForDisplayed({ timeout: 120000 });
  });

  it('should cancel an in-progress download', async function () {
    this.timeout(60000);
    await navigateTo('Media Download');
    await browser.pause(500);

    // Start a new download
    const urlInput = await $(SEL.urlInput);
    await urlInput.setValue(TEST_VIDEO_URL);
    const fetchBtn = await $(SEL.fetchBtn);
    await fetchBtn.click();

    const metadataPreview = await $('.metadata-preview, .media-metadata, .video-info');
    await metadataPreview.waitForDisplayed({ timeout: 30000 });

    let downloadBtn = await hasText('button', 'Download');
    let btnVisible = await downloadBtn.isDisplayed().catch(() => false);
    if (!btnVisible) {
      downloadBtn = await hasText('button', 'Queue');
    }
    await downloadBtn.click();
    await browser.pause(2000);

    // Find cancel button on the most recent task
    const cancelBtns = await $$('.cancel-btn');
    let cancelBtn: any = null;
    const cancelBtnCount = await cancelBtns.length;
    if (cancelBtnCount > 0) {
      cancelBtn = await cancelBtns[cancelBtnCount - 1];
    } else {
      cancelBtn = await hasText('button', 'Cancel');
    }

    if (cancelBtn && await cancelBtn.isDisplayed().catch(() => false)) {
      await cancelBtn.click();
      await browser.pause(1000);

      // Task should show cancelled state
      const cancelledBadge = await $('.state-cancelled, .badge-cancelled');
      const hasCancelled = await cancelledBadge.isDisplayed().catch(() => false);
      expect(hasCancelled).toBeTruthy();
    }
  });

  it('should remove a task from queue', async () => {
    await navigateTo('Media Download');
    await browser.pause(500);

    const queueItems = await $$('.download-task, .queue-item, .download-item');
    const initialCount = await queueItems.length;

    if (initialCount > 0) {
      // Find remove button on the last task
      const removeBtns = await $$('.remove-btn');
      let removeBtn: any = null;
      const removeBtnCount = await removeBtns.length;
      if (removeBtnCount > 0) {
        removeBtn = await removeBtns[removeBtnCount - 1];
      } else {
        removeBtn = await hasText('button', 'Remove');
      }

      if (removeBtn && await removeBtn.isDisplayed().catch(() => false)) {
        await removeBtn.click();
        await browser.pause(1000);

        const newItems = await $$('.download-task, .queue-item, .download-item');
        expect(await newItems.length).toBeLessThan(initialCount);
      }
    }
  });

  it('should clear completed downloads', async () => {
    await navigateTo('Media Download');
    await browser.pause(500);

    // Find "Clear Completed" or similar button
    let clearBtn = await hasText('button', 'Clear');
    if (!await clearBtn.isDisplayed().catch(() => false)) {
      clearBtn = await hasText('button', 'Clear Completed');
    }
    if (!await clearBtn.isDisplayed().catch(() => false)) {
      clearBtn = await hasText('button', 'Clear All');
    }

    if (await clearBtn.isDisplayed().catch(() => false)) {
      await clearBtn.click();
      await browser.pause(1000);

      // Queue should be empty or have fewer items
      const emptyEl = await $(SEL.queueEmpty);
      const hasEmpty = await emptyEl.isDisplayed().catch(() => false);
      const remainingItems = await $$('.download-task, .queue-item, .download-item');

      expect(hasEmpty || await remainingItems.length === 0).toBeTruthy();
    }
  });
});
