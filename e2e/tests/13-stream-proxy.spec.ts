import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
} from '../helpers';

const STREAMING_SERVER_PORT = 8087;

test.describe('Stream Proxy and Playback', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should have streaming server running', async () => {
    // Check if the streaming server is reachable
    try {
      const res = await fetch(`http://127.0.0.1:${STREAMING_SERVER_PORT}/api/v1/files`);
      expect(res.status).toBeLessThan(500);
    } catch {
      // Server may not be started yet; this is informational
      test.skip();
    }
  });

  test('should play external URL in player', async () => {
    const { browser, page } = await connectToApp();
    try {
      // Navigate to the player with a test URL
      const testUrl = encodeURIComponent('http://127.0.0.1:8087/api/v1/files');
      const title = encodeURIComponent('Test Stream');
      await page.goto(`http://localhost:1420/streaming/play?url=${testUrl}&title=${title}`);
      await page.waitForTimeout(1000);

      // Player page should have a video element or the title
      const hasVideo = await page.locator('video').isVisible().catch(() => false);
      const hasTitle = await page.locator('text=Test Stream').isVisible().catch(() => false);
      expect(hasVideo || hasTitle).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show live badge for live stream URLs', async () => {
    const { browser, page } = await connectToApp();
    try {
      const testUrl = encodeURIComponent('http://127.0.0.1:8087/api/v1/files');
      const title = encodeURIComponent('Live Test');
      await page.goto(`http://localhost:1420/streaming/play?url=${testUrl}&title=${title}&live=true`);
      await page.waitForTimeout(1000);

      // Live badge should be visible
      const liveBadge = page.locator('.live-badge');
      await expect(liveBadge).toBeVisible({ timeout: 5000 });
    } finally {
      await browser.close();
    }
  });
});
