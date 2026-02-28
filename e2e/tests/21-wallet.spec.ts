import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Wallet page — copy interaction, address format, network badge, contract rows.
 * NOTE: Wallet requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
test.describe('Wallet page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  /** Navigate to Wallet and return true if page rendered. */
  async function gotoWallet(page: import('@playwright/test').Page): Promise<boolean> {
    await navigateTo(page, 'Wallet');
    await page.waitForTimeout(1_000);
    return await page.locator(SEL.walletPage).isVisible({ timeout: 5_000 }).catch(() => false);
  }

  test('should navigate to Wallet page', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) {
        test.skip(true, 'Wallet feature not available in this build');
        return;
      }
      await expect(page.locator(SEL.walletPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const header = page.locator(SEL.walletHeader);
      await expect(header).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show wallet address starting with 0x', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const walletAddr = page.locator(SEL.walletAddress);
      const hasAddr = await walletAddr.isVisible().catch(() => false);

      if (hasAddr) {
        const addrText = await walletAddr.textContent();
        expect(addrText).toBeTruthy();
        expect(addrText!.trim()).toMatch(/0x[0-9a-fA-F]/);
      } else {
        const hasError = await page.locator('.mp-error').isVisible().catch(() => false);
        const hasEmpty = await page.locator(SEL.mpEmpty).isVisible().catch(() => false);
        expect(hasError || hasEmpty).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });

  test('should show network badge with network name', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const badge = page.locator(SEL.walletNetworkBadge);
      const hasBadge = await badge.isVisible().catch(() => false);

      if (hasBadge) {
        const badgeText = await badge.textContent();
        expect(badgeText).toBeTruthy();
        expect(badgeText!.trim().length).toBeGreaterThan(0);
      }
    } finally {
      await browser.close();
    }
  });

  test('should copy address on button click with Copied! feedback', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const copyBtn = page.locator(SEL.walletCopyBtn);
      const hasCopy = await copyBtn.isVisible().catch(() => false);

      if (!hasCopy) {
        test.skip(true, 'No copy button visible — wallet may not be loaded');
        return;
      }

      const initialText = await copyBtn.textContent();
      expect(initialText?.trim()).toBe('Copy');

      await copyBtn.click();
      await page.waitForTimeout(500);

      const copiedText = await copyBtn.textContent();
      expect(copiedText?.trim()).toBe('Copied!');

      await page.waitForTimeout(2_500);
      const revertedText = await copyBtn.textContent();
      expect(revertedText?.trim()).toBe('Copy');
    } finally {
      await browser.close();
    }
  });

  test('should show contract rows with addresses or Not deployed', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const contractRows = page.locator(SEL.walletContractRow);
      const rowCount = await contractRows.count();

      if (rowCount > 0) {
        for (let i = 0; i < rowCount; i++) {
          const row = contractRows.nth(i);

          const label = row.locator('.contract-label');
          await expect(label).toBeVisible();

          const rowText = await row.textContent();
          expect(rowText).toBeTruthy();
          const hasAddress = rowText!.includes('0x');
          const hasNotDeployed = rowText!.toLowerCase().includes('not deployed');
          expect(hasAddress || hasNotDeployed).toBeTruthy();
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should click refresh without crash', async () => {
    const { browser, page } = await connectToApp();
    try {
      const available = await gotoWallet(page);
      if (!available) { test.skip(true, 'Wallet not available'); return; }

      const refreshBtn = page.locator(SEL.mpRefreshBtn).first();
      const hasRefresh = await refreshBtn.isVisible().catch(() => false);

      if (hasRefresh) {
        await refreshBtn.click();
        await page.waitForTimeout(2_000);
        await expect(page.locator(SEL.walletPage)).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });
});
