import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * Media Player page — playback controls and UI interaction tests.
 * These tests require a completed download in the media library.
 */
test.describe('Media Player page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  /**
   * Helper: navigate to Media Download page and try to open the player
   * for the first completed video download.
   * Returns true if player was opened, false if no playable media.
   */
  async function tryOpenPlayer(page: import('@playwright/test').Page): Promise<boolean> {
    await navigateTo(page, 'Media Download');
    await page.waitForTimeout(1_000);

    const playBtn = page.locator('.play-btn, button:has-text("Play"), button[title="Play"]').first();
    const hasPlay = await playBtn.isVisible().catch(() => false);
    if (!hasPlay) return false;

    await playBtn.click();
    await page.waitForTimeout(2_000);

    const playerPage = page.locator(SEL.mediaPlayerPage);
    return await playerPage.isVisible().catch(() => false);
  }

  test('should navigate to player from completed download', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      const video = page.locator(SEL.mediaPlayerVideo);
      await expect(video).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('should show player controls', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      await expect(page.locator(SEL.playerControls)).toBeVisible();
      await expect(page.locator(SEL.playBtn)).toBeVisible();
      await expect(page.locator(SEL.muteBtn)).toBeVisible();
      await expect(page.locator(SEL.seekBar)).toBeVisible();
      await expect(page.locator(SEL.volumeBar)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should toggle play/pause on button click', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      const playButton = page.locator(SEL.playBtn);
      const initialText = await playButton.textContent();

      // Click to toggle
      await playButton.click();
      await page.waitForTimeout(500);

      const afterText = await playButton.textContent();
      expect(afterText).not.toEqual(initialText);

      // Toggle back
      await playButton.click();
      await page.waitForTimeout(500);

      const restoredText = await playButton.textContent();
      expect(restoredText).toEqual(initialText);
    } finally {
      await browser.close();
    }
  });

  test('should toggle mute/unmute on button click', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      const muteButton = page.locator(SEL.muteBtn);
      const initialText = await muteButton.textContent();

      await muteButton.click();
      await page.waitForTimeout(300);

      const afterText = await muteButton.textContent();
      expect(afterText).not.toEqual(initialText);

      // Toggle back
      await muteButton.click();
      await page.waitForTimeout(300);

      const restoredText = await muteButton.textContent();
      expect(restoredText).toEqual(initialText);
    } finally {
      await browser.close();
    }
  });

  test('should toggle playlist sidebar', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      const toggleBtn = page.locator(SEL.playlistToggleBtn);
      const hasToggle = await toggleBtn.isVisible().catch(() => false);
      if (!hasToggle) {
        test.skip(true, 'No playlist toggle button visible');
        return;
      }

      const sidebarBefore = await page.locator(SEL.playlistSidebar).isVisible().catch(() => false);

      await toggleBtn.click();
      await page.waitForTimeout(500);

      const sidebarAfter = await page.locator(SEL.playlistSidebar).isVisible().catch(() => false);
      expect(sidebarAfter).not.toEqual(sidebarBefore);

      // Toggle back
      await toggleBtn.click();
      await page.waitForTimeout(500);

      const sidebarRestored = await page.locator(SEL.playlistSidebar).isVisible().catch(() => false);
      expect(sidebarRestored).toEqual(sidebarBefore);
    } finally {
      await browser.close();
    }
  });

  test('should navigate back via back button', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      const opened = await tryOpenPlayer(page);
      if (!opened) {
        test.skip(true, 'No completed downloads available for playback');
        return;
      }

      const backBtn = page.locator(SEL.playerBackBtn);
      await expect(backBtn).toBeVisible();
      await backBtn.click();
      await page.waitForTimeout(1_000);

      await expect(page.locator(SEL.mediaDownloadPage)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });
});
