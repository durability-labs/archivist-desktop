/**
 * Test fixtures that attach to the running Archivist Desktop app via CDP and
 * provide convenience helpers for driving the real UI + reading backend logs.
 */
import { test as base, chromium, Page, BrowserContext, Browser } from '@playwright/test';
import * as fs from 'fs';
import { readNodeLog, LogTail } from './log';

/**
 * Walk through the splash → disclaimer → welcome intro cards. These play on
 * every launch, so test setup has to click through them to reach the main app.
 *
 * Assumes `archivist_onboarding_complete=true` is set so Welcome's Get Started
 * routes to Dashboard instead of continuing into wallet-setup.
 */
/**
 * Click through the intro cards. Assumes `__archivist_test_skip_splash=true`
 * is set so the splash VIDEO is bypassed — only disclaimer + welcome remain.
 *
 * Uses page.evaluate() + native DOM click for the button interactions because
 * Playwright's CDP-dispatched events don't reliably propagate through React's
 * production-build event system in WebView2.
 */
export async function skipIntroCards(page: Page): Promise<void> {
  // Wait for EITHER disclaimer heading or sidebar (maybe intro was already
  // clicked through from a prior test on the same page).
  await page.locator('.disclaimer-screen, .sidebar, .welcome-screen').first().waitFor({
    state: 'visible',
    timeout: 15_000,
  });

  // Click "I Understand & Accept" via native DOM click.
  const clickedDisclaimer = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent?.includes('I Understand'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (clickedDisclaimer) {
    await page.waitForTimeout(500);
  }

  // Click "Get Started" via native DOM click.
  const clickedWelcome = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent?.trim() === 'Get Started');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clickedWelcome) {
    // Maybe welcome didn't render yet — wait and retry.
    await page.locator('.welcome-screen').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent?.trim() === 'Get Started');
      if (btn) btn.click();
    });
  }
  await page.waitForTimeout(500);
}

interface AppFixtures {
  /** The archivist-desktop WebView2 page (only one in a Tauri app). */
  page: Page;
  /** Browser context pinned to the live WebView. */
  context: BrowserContext;
  /** Raw browser handle (don't close — the app owns it). */
  browser: Browser;
  /** Absolute path to the sidecar node.log for log assertions. */
  nodeLogPath: string;
  /** Factory: snapshot node.log contents at a point in time. */
  tailNodeLog: () => LogTail;
}

export const test = base.extend<AppFixtures>({
  // Connect once per test file to the existing CDP endpoint.
  browser: async ({}, use) => {
    const cdpUrl = process.env.ARCHIVIST_CDP_URL;
    if (!cdpUrl) {
      throw new Error(
        'ARCHIVIST_CDP_URL not set. Run tests via scripts/run-app-e2e.ps1, not directly.',
      );
    }
    const browser = await chromium.connectOverCDP(cdpUrl);
    await use(browser);
    // Don't close — the app binary owns the browser. Just disconnect.
    await browser.close().catch(() => {});
  },

  context: async ({ browser }, use) => {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('No browser contexts exposed by CDP — is the app running?');
    }
    // Tauri v2 on Windows serves the app from http://tauri.localhost.
    // Other CDP-exposing WebView2 apps on the same port would show different
    // URLs, so we pick the context that actually owns our WebView.
    const isAppUrl = (u: string) =>
      !!u && (u.includes('tauri.localhost') || u.includes('tauri://') || u.includes('localhost:1420'));
    let chosen = contexts[0];
    for (const ctx of contexts) {
      for (const pg of ctx.pages()) {
        if (isAppUrl(pg.url())) {
          chosen = ctx;
          break;
        }
      }
    }
    await use(chosen);
  },

  page: async ({ context }, use) => {
    const isAppUrl = (u: string) =>
      !!u && (u.includes('tauri.localhost') || u.includes('tauri://') || u.includes('localhost:1420'));

    const findAppPage = () => context.pages().find((p) => isAppUrl(p.url()));
    let page = findAppPage();
    if (!page) {
      // WebView may not be attached yet — wait for any new page and re-check.
      for (let i = 0; i < 30 && !page; i++) {
        await new Promise((r) => setTimeout(r, 500));
        page = findAppPage();
      }
    }
    if (!page) {
      const allUrls = context.pages().map((p) => p.url());
      throw new Error(
        `Could not find Archivist WebView among CDP pages. Got: ${JSON.stringify(allUrls)}`,
      );
    }
    await page.bringToFront().catch(() => {});

    // Mark first-run setup complete, and skip the splash video (the <video>
    // element is unreliable under CDP). Disclaimer + Welcome still play —
    // skipIntroCards clicks through them.
    await page.evaluate(() => {
      localStorage.setItem('archivist_onboarding_complete', 'true');
      sessionStorage.setItem('__archivist_test_skip_splash', 'true');
      localStorage.removeItem('archivist_onboarding_step');
    }).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

    await skipIntroCards(page);
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30_000 });
    await use(page);
  },

  nodeLogPath: async ({}, use) => {
    const logPath = process.env.ARCHIVIST_NODE_LOG;
    if (!logPath) {
      throw new Error('ARCHIVIST_NODE_LOG not set by run-app-e2e.ps1');
    }
    await use(logPath);
  },

  tailNodeLog: async ({ nodeLogPath }, use) => {
    // A factory so each test can anchor "new log lines" at a chosen moment.
    const factory = () => {
      const initial = fs.existsSync(nodeLogPath) ? fs.statSync(nodeLogPath).size : 0;
      return readNodeLog(nodeLogPath, initial);
    };
    await use(factory);
  },
});

export { expect } from '@playwright/test';
