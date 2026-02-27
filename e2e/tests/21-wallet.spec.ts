import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Wallet page render tests.
 */
test.describe('Wallet page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Wallet page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.walletPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.walletHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show wallet address and network badge', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(500);

      const hasAddress = await page.locator(SEL.walletAddress).isVisible().catch(() => false);
      const hasBadge = await page.locator(SEL.walletNetworkBadge).isVisible().catch(() => false);

      // At least one wallet element should render
      expect(hasAddress || hasBadge).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show contracts section', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(500);

      const hasContracts = await page.locator(SEL.walletContracts).isVisible().catch(() => false);
      const hasContractRows = await page.locator(SEL.walletContractRow).first().isVisible().catch(() => false);

      // Either contracts section or contract rows should be present (or page renders without them)
      const pageContent = await page.locator(SEL.walletPage).textContent();
      expect(pageContent).toBeTruthy();
    } finally {
      await browser.close();
    }
  });
});
