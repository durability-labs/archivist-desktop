import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

test.describe('Streaming TV page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display Streaming TV page with header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.streamingHeader);
      await expect(header).toHaveText('Streaming TV');
    } finally {
      await browser.close();
    }
  });

  test('should show tab bar with Discover, IPTV, Addons, Settings tabs', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.tabDiscover)).toBeVisible();
      await expect(page.locator(SEL.tabIptv)).toBeVisible();
      await expect(page.locator(SEL.tabAddons)).toBeVisible();
      await expect(page.locator(SEL.tabSettings)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should default to Discover tab active', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      const activeTab = page.locator(SEL.tabActive);
      await expect(activeTab).toHaveText('Discover');
    } finally {
      await browser.close();
    }
  });

  test('should switch to IPTV tab on click', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await page.locator(SEL.tabIptv).click();
      await page.waitForTimeout(300);

      const activeTab = page.locator(SEL.tabActive);
      await expect(activeTab).toHaveText('IPTV');
    } finally {
      await browser.close();
    }
  });

  test('should switch to Addons tab on click', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await page.locator(SEL.tabAddons).click();
      await page.waitForTimeout(300);

      const activeTab = page.locator(SEL.tabActive);
      await expect(activeTab).toHaveText('Addons');
    } finally {
      await browser.close();
    }
  });

  test('should switch to Settings tab on click', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await page.locator(SEL.tabSettings).click();
      await page.waitForTimeout(300);

      const activeTab = page.locator(SEL.tabActive);
      await expect(activeTab).toHaveText('Settings');
    } finally {
      await browser.close();
    }
  });

  test('should show empty state on Discover when no addons installed', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.catalogEmpty)).toBeVisible();
      await expect(page.locator('text=No Content Available')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show IPTV management on IPTV tab', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Streaming TV');
      await page.waitForTimeout(500);

      await page.locator(SEL.tabIptv).click();
      await page.waitForTimeout(300);

      // Should show the playlist URL input
      await expect(page.locator(SEL.iptvPlaylistInput)).toBeVisible();
      await expect(page.locator(SEL.iptvPlaylistName)).toBeVisible();
      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
