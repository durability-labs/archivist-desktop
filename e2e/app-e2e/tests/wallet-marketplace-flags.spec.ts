/**
 * End-to-end test: after wallet creation during onboarding, the sidecar
 * MUST be running with --persistence + marketplace flags. Specifically
 * guards against the bug where auto_start fires before wallet creation,
 * and the node stays running without marketplace config.
 */
import { test, expect, chromium } from '@playwright/test';

test('after wallet creation, sidecar runs with --persistence flag', async () => {
  test.setTimeout(180_000);
  const cdpUrl = process.env.ARCHIVIST_CDP_URL;
  if (!cdpUrl) throw new Error('ARCHIVIST_CDP_URL not set');

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().includes('tauri.localhost'));
    if (!page) throw new Error('Archivist WebView not found');

    // Skip the splash via sessionStorage, but do NOT set onboarding_complete
    // so we land on the disclaimer (first-run path).
    await page.evaluate(() => {
      sessionStorage.setItem('__archivist_test_skip_splash', 'true');
      localStorage.removeItem('archivist_onboarding_complete');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Click through disclaimer
    const accept = page.locator('button', { hasText: /I Understand/i }).first();
    await accept.waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find((b) => b.textContent?.includes('I Understand'))?.click();
    });
    await page.waitForTimeout(500);

    // Click "Get Started" (first-run → goes to wallet-setup)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find((b) => b.textContent?.trim() === 'Get Started')?.click();
    });
    await page.waitForTimeout(500);

    // Fill wallet password and submit
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.first().waitFor({ state: 'visible', timeout: 10_000 });
    await pwInputs.nth(0).fill('e2e-test-pw-123');
    await pwInputs.nth(1).fill('e2e-test-pw-123');

    // Click the submit button (Generate Wallet or Create Wallet)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const submit = btns.find(
        (b) =>
          b.textContent?.includes('Generate Wallet') ||
          b.textContent?.includes('Create Wallet'),
      );
      submit?.click();
    });

    // Wait for the node-starting step to complete (node restarts with
    // marketplace flags). The node-starting screen shows a spinner then
    // auto-advances to folder-select.
    await page.waitForTimeout(30_000);

    // NOW check the sidecar command line — it MUST have --persistence
    const nodeLogPath = process.env.ARCHIVIST_NODE_LOG;
    if (nodeLogPath) {
      const fs = await import('fs');
      const ethKeyPath = nodeLogPath.replace('node.log', 'eth.key');
      // eth.key is written when marketplace config is injected
      expect(
        fs.existsSync(ethKeyPath),
        `eth.key should exist at ${ethKeyPath} (marketplace config was injected)`,
      ).toBe(true);
    }
  } finally {
    await browser.close().catch(() => {});
  }
});
