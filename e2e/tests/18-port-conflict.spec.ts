import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, sleep, SEL } from '../helpers';
import * as net from 'net';

/**
 * Phase 18 — Port conflict error banner (Playwright via CDP)
 *
 * Verifies that when port 8080 is occupied, the Dashboard shows a
 * user-friendly error banner without raw socket info from `ss`.
 */

test.describe.serial('Port conflict error banner', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should show friendly error when port is occupied and hide raw socket info', async () => {
    const { browser, page } = await connectToApp();

    // We'll occupy port 8080 with a dummy server
    let blocker: net.Server | null = null;

    try {
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(500);

      // 1. Stop the node so we can occupy its port
      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('stop_node'),
      ).catch(() => {/* may already be stopped */});
      await sleep(1_000);

      // 2. Occupy port 8080 with a TCP server
      blocker = await new Promise<net.Server>((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(8080, '0.0.0.0', () => resolve(srv));
      });

      // 3. Attempt to start the node — should fail with port conflict
      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('start_node'),
      ).catch(() => {/* expected to fail */});
      await sleep(2_000);

      // 4. Navigate to Dashboard to pick up status
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(1_500);

      // 5. The enhanced error banner should be visible
      const banner = page.locator(SEL.errorBannerEnhanced);
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // 6. Check heading text
      await expect(banner.locator('strong')).toHaveText('Node cannot start');

      // 7. Check "already in use" message is present
      const bannerText = await banner.textContent() ?? '';
      expect(bannerText).toContain('already in use');

      // 8. "Change Port" action link should be visible
      const actionLink = page.locator(SEL.errorBannerAction);
      await expect(actionLink).toBeVisible();
      await expect(actionLink).toHaveText('Change Port');

      // 9. Raw socket info should NOT be present
      expect(bannerText).not.toMatch(/LISTEN\s+\d/);
      expect(bannerText).not.toContain('users:((');
      expect(bannerText).not.toMatch(/fd=\d/);

      // 10. Release port and restart node
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
      await sleep(500);

      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('start_node'),
      );
      await sleep(3_000);

      // Refresh dashboard
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(2_000);

      // Banner should be gone
      await expect(page.locator(SEL.errorBannerEnhanced)).not.toBeVisible({ timeout: 10_000 });

      // "Running" should appear
      const running = page.locator('text=Running').first();
      await expect(running).toBeVisible({ timeout: 15_000 });
    } finally {
      // Clean up blocker if still open
      if (blocker) {
        await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      }
      await browser.close();
    }
  });
});
