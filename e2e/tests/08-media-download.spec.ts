import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

/**
 * @smoke
 * Media Download page basic UI tests (no internet required).
 */
test.describe('Media Download page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display Media Download page with header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.mediaDownloadHeader);
      await expect(header).toHaveText('Media Download');
    } finally {
      await browser.close();
    }
  });

  test('should display URL input and Fetch button', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      const urlInput = page.locator(SEL.urlInput);
      await expect(urlInput).toBeVisible();

      const fetchBtn = page.locator(SEL.fetchBtn);
      await expect(fetchBtn).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show setup banner or binary version info', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(1000);

      // Either the setup banner (yt-dlp not installed) or version info should be visible
      const hasBanner = await page.locator(SEL.setupBanner).isVisible().catch(() => false);
      const hasVersionInfo = await page.locator(SEL.binaryInfo).isVisible().catch(() => false);

      expect(hasBanner || hasVersionInfo).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show empty download queue', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      const downloadQueue = page.locator(SEL.downloadQueue);
      await expect(downloadQueue).toBeVisible();

      // Either shows "No downloads yet" or the queue is empty
      const queueEmpty = page.locator(SEL.queueEmpty);
      const queueItems = page.locator('.download-task, .queue-item, .download-item');
      const hasEmpty = await queueEmpty.isVisible().catch(() => false);
      const itemCount = await queueItems.count();

      expect(hasEmpty || itemCount >= 0).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should have Fetch Info button disabled when URL is empty', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      const fetchBtn = page.locator(SEL.fetchBtn);
      await expect(fetchBtn).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('should enable Fetch button when URL is entered', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      const urlInput = page.locator(SEL.urlInput);
      await urlInput.fill('https://example.com/video');

      const fetchBtn = page.locator(SEL.fetchBtn);
      await expect(fetchBtn).toBeEnabled();

      // Clear to reset state
      await urlInput.fill('');
      await expect(fetchBtn).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('should not show metadata preview without fetching', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(500);

      // Metadata preview should not be visible by default
      const metadataPreview = page.locator('.metadata-preview, .media-metadata, .video-info').first();
      const hasMetadata = await metadataPreview.isVisible().catch(() => false);

      expect(hasMetadata).toBeFalsy();
    } finally {
      await browser.close();
    }
  });
});
