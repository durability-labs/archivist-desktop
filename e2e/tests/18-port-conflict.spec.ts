import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, sleep, SEL } from '../helpers';
import * as net from 'net';

/**
 * Phase 18 — Port conflict error banner
 *
 * Verifies that when port 8080 is occupied, the Dashboard shows a
 * user-friendly error banner without raw socket info from `ss`.
 */

describe('Port conflict error banner', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('should show friendly error when port is occupied and hide raw socket info', async function () {
    this.timeout(60_000);

    // We'll occupy port 8080 with a dummy server
    let blocker: net.Server | null = null;

    try {
      await navigateTo('Dashboard');
      await browser.pause(500);

      // 1. Stop the node so we can occupy its port
      await browser.execute(() =>
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
      await browser.execute(() =>
        (window as any).__TAURI__.invoke('start_node'),
      ).catch(() => {/* expected to fail */});
      await sleep(2_000);

      // 4. Navigate to Dashboard to pick up status
      await navigateTo('Dashboard');
      await browser.pause(1_500);

      // 5. The enhanced error banner should be visible
      const banner = $(SEL.errorBannerEnhanced);
      await banner.waitForDisplayed({ timeout: 10_000 });

      // 6. Check heading text
      const strong = banner.$('strong');
      await expect(strong).toHaveText('Node cannot start');

      // 7. Check "already in use" message is present
      const bannerText = await banner.getText();
      expect(bannerText).toContain('already in use');

      // 8. "Change Port" action link should be visible
      const actionLink = $(SEL.errorBannerAction);
      await expect(actionLink).toBeDisplayed();
      await expect(actionLink).toHaveText('Change Port');

      // 9. Raw socket info should NOT be present
      expect(bannerText).not.toMatch(/LISTEN\s+\d/);
      expect(bannerText).not.toContain('users:((');
      expect(bannerText).not.toMatch(/fd=\d/);

      // 10. Release port and restart node
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
      await sleep(500);

      await browser.execute(() =>
        (window as any).__TAURI__.invoke('start_node'),
      );
      await sleep(3_000);

      // Refresh dashboard
      await navigateTo('Dashboard');
      await browser.pause(2_000);

      // Banner should be gone
      const bannerGone = $(SEL.errorBannerEnhanced);
      await bannerGone.waitForDisplayed({ timeout: 10_000, reverse: true });

      // "Running" should appear
      const running = $('*=Running');
      await running.waitForDisplayed({ timeout: 15_000 });
    } finally {
      // Clean up blocker if still open
      if (blocker) {
        await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      }
    }
  });
});
