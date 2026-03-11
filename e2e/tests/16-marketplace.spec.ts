import { test, expect, chromium, type Page, type Browser } from '@playwright/test';

/**
 * Marketplace UI E2E tests.
 *
 * These tests launch Chromium directly against the Vite dev server
 * (http://localhost:1420) rather than connecting over CDP to WebView2.
 * Tauri IPC calls will fail, but we can verify all UI structure renders.
 *
 * Onboarding is bypassed by setting localStorage before the app reads it.
 */

const VITE_URL = 'http://localhost:1420';

/** Navigate to a route with onboarding bypassed. */
async function gotoWithBypass(page: Page, path: string): Promise<void> {
  // Load the page to get a browsing context for localStorage
  await page.goto(VITE_URL, { waitUntil: 'commit' });
  await page.evaluate(() => {
    localStorage.setItem('archivist_onboarding_complete', 'true');
  });
  // Now navigate to the target route — React will see the flag and skip onboarding
  await page.goto(`${VITE_URL}${path}`, { waitUntil: 'networkidle' });
}

test.describe('Marketplace UI', () => {
  test('Marketplace accordion is visible and expandable', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/');

      // The Marketplace accordion header should be visible in the sidebar
      const mpAccordion = page.locator('.sidebar .nav-accordion-header:has-text("Marketplace")');
      await expect(mpAccordion).toBeVisible({ timeout: 10_000 });

      // Click to expand the accordion
      await mpAccordion.click();
      await page.waitForTimeout(500);

      // After expanding, all three links should be visible
      await expect(page.locator('.sidebar .nav-link:has-text("Browse")')).toBeVisible({ timeout: 3_000 });
      await expect(page.locator('.sidebar .nav-link:has-text("My Deals")')).toBeVisible();
      await expect(page.locator('.sidebar .nav-link:has-text("Wallet")')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('/marketplace renders with Offer Storage and Request Storage sections', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/marketplace');

      // Page header
      const header = page.locator('.marketplace-page h1');
      await expect(header).toHaveText('Marketplace', { timeout: 10_000 });

      // Two mp-section blocks: "Offer Storage" and "Request Storage"
      const sections = page.locator('.mp-section');
      await expect(sections).toHaveCount(2, { timeout: 5_000 });

      // Verify section headings
      await expect(page.locator('.mp-section h2:has-text("Offer Storage")')).toBeVisible();
      await expect(page.locator('.mp-section h2:has-text("Request Storage")')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('/marketplace — availability form has all fields', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/marketplace');
      await expect(page.locator('.marketplace-page h1')).toBeVisible({ timeout: 10_000 });

      // The first mp-form is the "Set Availability" form (Offer Storage section)
      const form = page.locator('.mp-form').first();
      await expect(form).toBeVisible();

      // Check all four provider fields
      await expect(form.locator('.mp-field label:has-text("Total Size")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Duration")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Min Price")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Max Collateral")')).toBeVisible();

      // Submit button
      const submitBtn = page.locator('.mp-submit-btn').first();
      await expect(submitBtn).toBeVisible();
      await expect(submitBtn).toHaveText('Publish Availability');
    } finally {
      await browser.close();
    }
  });

  test('/marketplace — storage request form has CID input and parameter fields', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/marketplace');
      await expect(page.locator('.marketplace-page h1')).toBeVisible({ timeout: 10_000 });

      // The second mp-form is the "Request Storage" form
      const form = page.locator('.mp-form').nth(1);
      await expect(form).toBeVisible();

      // CID input
      await expect(form.locator('.mp-field label:has-text("CID")')).toBeVisible();
      await expect(form.locator('input[placeholder*="CID"]')).toBeVisible();

      // Parameter fields
      await expect(form.locator('.mp-field label:has-text("Duration")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Price per Byte")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Collateral per Byte")')).toBeVisible();
      await expect(form.locator('.mp-field label:has-text("Slots")')).toBeVisible();

      // Submit button
      const submitBtn = page.locator('.mp-submit-btn').nth(1);
      await expect(submitBtn).toBeVisible();
      await expect(submitBtn).toHaveText('Create Storage Request');
    } finally {
      await browser.close();
    }
  });

  test('/marketplace/deals renders My Purchases and My Slots sections', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/marketplace/deals');

      // Page header
      const header = page.locator('.deals-page h1');
      await expect(header).toHaveText('My Deals', { timeout: 10_000 });

      // Two mp-section blocks: "My Purchases" and "My Slots"
      const sections = page.locator('.mp-section');
      await expect(sections).toHaveCount(2, { timeout: 5_000 });

      await expect(page.locator('.mp-section h2:has-text("My Purchases")')).toBeVisible();
      await expect(page.locator('.mp-section h2:has-text("My Slots")')).toBeVisible();

      // Empty states should be visible (no real node to provide data)
      const emptyStates = page.locator('.mp-empty');
      const emptyCount = await emptyStates.count();
      expect(emptyCount).toBeGreaterThanOrEqual(1);
    } finally {
      await browser.close();
    }
  });

  test('/wallet renders address section, network badge, and contract addresses', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await gotoWithBypass(page, '/wallet');

      // Page header
      const header = page.locator('.wallet-page h1');
      await expect(header).toHaveText('Wallet', { timeout: 10_000 });

      // Network badge
      const networkBadge = page.locator('.wallet-network-badge');
      await expect(networkBadge).toBeVisible();

      // Wallet address section
      const walletAddress = page.locator('.wallet-address');
      await expect(walletAddress).toBeVisible();

      // Contract addresses section
      const contracts = page.locator('.wallet-contracts');
      await expect(contracts).toBeVisible();

      // Should have 3 contract rows (Marketplace, Token, Verifier)
      const contractRows = page.locator('.wallet-contract-row');
      await expect(contractRows).toHaveCount(3);

      // Verify contract labels
      await expect(page.locator('.contract-label:has-text("Marketplace")')).toBeVisible();
      await expect(page.locator('.contract-label:has-text("Token")')).toBeVisible();
      await expect(page.locator('.contract-label:has-text("Verifier")')).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
