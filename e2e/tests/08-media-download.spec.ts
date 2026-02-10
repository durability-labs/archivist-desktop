import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

test.describe('Media Download page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display Media Download page with header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
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
      await navigateTo(page, 'Media Download');
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
      await navigateTo(page, 'Media Download');
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
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      // Should show "No downloads yet" or the Downloads heading
      const queueEmpty = page.locator(SEL.queueEmpty);
      const downloadQueue = page.locator(SEL.downloadQueue);

      await expect(downloadQueue).toBeVisible();
      await expect(queueEmpty).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should have Fetch Info button disabled when URL is empty', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      const fetchBtn = page.locator(SEL.fetchBtn);
      await expect(fetchBtn).toBeDisabled();
    } finally {
      await browser.close();
    }
  });
});
