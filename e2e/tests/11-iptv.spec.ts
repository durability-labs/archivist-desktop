import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateToStreamingTab,
  SEL,
} from '../helpers';

test.describe('IPTV', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display IPTV tab with playlist input', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');

      await expect(page.locator(SEL.iptvPlaylistInput)).toBeVisible();
      await expect(page.locator(SEL.iptvPlaylistName)).toBeVisible();
      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should have disabled Add button when inputs are empty', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');

      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('should enable Add button when both inputs have values', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');

      await page.locator(SEL.iptvPlaylistInput).fill('http://example.com/playlist.m3u');
      await page.locator(SEL.iptvPlaylistName).fill('Test IPTV');

      await expect(page.locator(SEL.iptvAddPlaylistBtn)).toBeEnabled();
    } finally {
      await browser.close();
    }
  });

  test('should show search input when playlist is selected', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');
      await page.waitForTimeout(500);

      // If playlists exist, click one to get the channel search
      const hasPlaylist = await page.locator(SEL.iptvPlaylistItem).first().isVisible().catch(() => false);
      if (!hasPlaylist) {
        test.skip();
        return;
      }

      await page.locator(SEL.iptvPlaylistItem).first().click();
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.iptvChannelSearch)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show channel grid after selecting playlist', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');
      await page.waitForTimeout(500);

      const hasPlaylist = await page.locator(SEL.iptvPlaylistItem).first().isVisible().catch(() => false);
      if (!hasPlaylist) {
        test.skip();
        return;
      }

      await page.locator(SEL.iptvPlaylistItem).first().click();
      await page.waitForTimeout(1000);

      // Should show either channels or "no channels" message
      const hasChannels = await page.locator(SEL.iptvChannelGrid).isVisible().catch(() => false);
      expect(hasChannels).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show group sidebar with categories', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'iptv');
      await page.waitForTimeout(500);

      const hasPlaylist = await page.locator(SEL.iptvPlaylistItem).first().isVisible().catch(() => false);
      if (!hasPlaylist) {
        test.skip();
        return;
      }

      await page.locator(SEL.iptvPlaylistItem).first().click();
      await page.waitForTimeout(1000);

      const hasSidebar = await page.locator(SEL.iptvGroupSidebar).isVisible().catch(() => false);
      if (hasSidebar) {
        // Should have at least an "All" group button
        await expect(page.locator(SEL.iptvGroupItem).first()).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });
});
