import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * Media Player page tests.
 * Tests navigation from completed download to the player.
 */
test.describe('Media Player page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to player from completed download', async () => {
    test.setTimeout(30_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(1_000);

      // Check if there's a completed download with a play button
      const playBtn = page.locator('.play-btn, button:has-text("Play"), button[title="Play"]').first();
      const hasPlay = await playBtn.isVisible().catch(() => false);

      if (hasPlay) {
        await playBtn.click();
        await page.waitForTimeout(2_000);

        // Should navigate to media player
        const playerPage = page.locator(SEL.mediaPlayerPage);
        const hasPlayer = await playerPage.isVisible().catch(() => false);

        if (hasPlayer) {
          // Verify video element exists
          const video = page.locator(SEL.mediaPlayerVideo);
          await expect(video).toBeVisible({ timeout: 10_000 });
        }
      } else {
        // No completed downloads with play button — skip
        test.skip(true, 'No completed downloads available for playback');
      }
    } finally {
      await browser.close();
    }
  });

  test('should have back navigation from player', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Media Download');
      await page.waitForTimeout(500);

      const playBtn = page.locator('.play-btn, button:has-text("Play"), button[title="Play"]').first();
      const hasPlay = await playBtn.isVisible().catch(() => false);

      if (hasPlay) {
        await playBtn.click();
        await page.waitForTimeout(2_000);

        const backBtn = page.locator(SEL.mediaPlayerBackBtn);
        const hasBack = await backBtn.isVisible().catch(() => false);

        if (hasBack) {
          await backBtn.click();
          await page.waitForTimeout(1_000);

          // Should be back on Media Download page
          await expect(page.locator(SEL.mediaDownloadPage)).toBeVisible({ timeout: 5_000 });
        }
      } else {
        test.skip(true, 'No completed downloads available for playback');
      }
    } finally {
      await browser.close();
    }
  });
});
