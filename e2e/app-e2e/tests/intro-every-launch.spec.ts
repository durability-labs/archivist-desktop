/**
 * End-to-end regression: the splash intro plays on EVERY launch, the Skip
 * button is gone, and the Welcome card has no "Skip for now".
 */
import { test, expect, chromium } from '@playwright/test';
import { skipIntroCards } from '../fixtures/app';

test.describe('Onboarding — intro every launch (real app)', () => {
  test('fresh mount with completion flag set still lands on the splash screen', async () => {
    const cdpUrl = process.env.ARCHIVIST_CDP_URL;
    if (!cdpUrl) throw new Error('ARCHIVIST_CDP_URL not set — run via scripts/run-app-e2e.ps1');

    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const context = browser.contexts()[0];
      const page = context.pages().find((p) => p.url().includes('tauri.localhost'));
      if (!page) throw new Error('Archivist WebView not found');

      // Reload WITHOUT the test-skip-splash flag — we want to see the real splash.
      await page.evaluate(() => {
        localStorage.setItem('archivist_onboarding_complete', 'true');
        localStorage.removeItem('archivist_onboarding_step');
        sessionStorage.removeItem('__archivist_test_skip_splash');
        localStorage.removeItem('__archivist_test_skip_splash');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      // The splash should render before anything else.
      await expect(page.locator('.splash-screen')).toBeVisible({ timeout: 15_000 });

      // The sidebar should NOT be visible — we're gated behind intro cards.
      await expect(page.locator('.sidebar')).toHaveCount(0);

      // The Skip button on the splash must be gone — intro is unskippable.
      await expect(page.locator('.splash-skip')).toHaveCount(0);

      // Clean up: skip splash via the test flag, then click through cards.
      await page.evaluate(() => {
        sessionStorage.setItem('__archivist_test_skip_splash', 'true');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await skipIntroCards(page);
      await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30_000 });
    } finally {
      await browser.close().catch(() => {});
    }
  });

  test('Welcome card has no "Skip for now" button', async () => {
    const cdpUrl = process.env.ARCHIVIST_CDP_URL;
    if (!cdpUrl) throw new Error('ARCHIVIST_CDP_URL not set');

    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const context = browser.contexts()[0];
      const page = context.pages().find((p) => p.url().includes('tauri.localhost'));
      if (!page) throw new Error('Archivist WebView not found');

      // Skip splash via test flag to get to disclaimer quickly.
      await page.evaluate(() => {
        localStorage.setItem('archivist_onboarding_complete', 'true');
        sessionStorage.setItem('__archivist_test_skip_splash', 'true');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Click through disclaimer to reach Welcome (use native DOM click —
      // CDP-dispatched events are unreliable in WebView2 production builds).
      await page.locator('.disclaimer-screen').waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find((b) => b.textContent?.includes('I Understand'));
        if (btn) btn.click();
      });
      await page.waitForTimeout(500);

      // Welcome is now visible. Assert the skip affordance is absent.
      await page.locator('.welcome-screen').waitFor({ state: 'visible', timeout: 10_000 });
      const hasSkipForNow = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.welcome-screen button'));
        return btns.some((b) => b.textContent?.includes('Skip for now'));
      });
      expect(hasSkipForNow).toBe(false);

      const hasGetStarted = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.welcome-screen button'));
        return btns.some((b) => b.textContent?.trim() === 'Get Started');
      });
      expect(hasGetStarted).toBe(true);

      // Proceed so subsequent tests start clean (use native click).
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find((b) => b.textContent?.trim() === 'Get Started');
        if (btn) btn.click();
      });
      await page.waitForTimeout(500);
      await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30_000 });
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
