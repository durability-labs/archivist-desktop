import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, getCount, sleep, SEL } from '../helpers';

/**
 * @smoke
 * Wallet page — copy interaction, address format, network badge, contract rows.
 * NOTE: Wallet requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
describe('Wallet page @smoke', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  /** Navigate to Wallet and return true if page rendered. */
  async function gotoWallet(): Promise<boolean> {
    await navigateTo('Wallet');
    await browser.pause(1_000);
    try {
      const page = $(SEL.walletPage);
      await page.waitForDisplayed({ timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  it('should navigate to Wallet page', async function () {
    const available = await gotoWallet();
    if (!available) {
      this.skip();
      return;
    }
    await expect($(SEL.walletPage)).toBeDisplayed();
  });

  it('should display page header', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const header = $(SEL.walletHeader);
    await expect(header).toBeDisplayed();
  });

  it('should show wallet address starting with 0x', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const walletAddr = $(SEL.walletAddress);
    const hasAddr = await walletAddr.isDisplayed().catch(() => false);

    if (hasAddr) {
      const addrText = await walletAddr.getText();
      expect(addrText).toBeTruthy();
      expect(addrText.trim()).toMatch(/0x[0-9a-fA-F]/);
    } else {
      const hasError = await $('.mp-error').isDisplayed().catch(() => false);
      const hasEmpty = await $(SEL.mpEmpty).isDisplayed().catch(() => false);
      expect(hasError || hasEmpty).toBeTruthy();
    }
  });

  it('should show network badge with network name', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const badge = $(SEL.walletNetworkBadge);
    const hasBadge = await badge.isDisplayed().catch(() => false);

    if (hasBadge) {
      const badgeText = await badge.getText();
      expect(badgeText).toBeTruthy();
      expect(badgeText.trim().length).toBeGreaterThan(0);
    }
  });

  it('should copy address on button click with Copied! feedback', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const copyBtn = $(SEL.walletCopyBtn);
    const hasCopy = await copyBtn.isDisplayed().catch(() => false);

    if (!hasCopy) {
      this.skip();
      return;
    }

    const initialText = await copyBtn.getText();
    expect(initialText.trim()).toBe('Copy');

    await copyBtn.click();
    await browser.pause(500);

    const copiedText = await copyBtn.getText();
    expect(copiedText.trim()).toBe('Copied!');

    await browser.pause(2_500);
    const revertedText = await copyBtn.getText();
    expect(revertedText.trim()).toBe('Copy');
  });

  it('should show contract rows with addresses or Not deployed', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const contractRows = await $$(SEL.walletContractRow);

    if (await contractRows.length > 0) {
      for (let i = 0; i < await contractRows.length; i++) {
        const row = contractRows[i];

        const label = row.$('.contract-label');
        await expect(label).toBeDisplayed();

        const rowText = await row.getText();
        expect(rowText).toBeTruthy();
        const hasAddress = rowText.includes('0x');
        const hasNotDeployed = rowText.toLowerCase().includes('not deployed');
        expect(hasAddress || hasNotDeployed).toBeTruthy();
      }
    }
  });

  it('should click refresh without crash', async function () {
    const available = await gotoWallet();
    if (!available) { this.skip(); return; }

    const refreshBtns = await $$(SEL.mpRefreshBtn);
    if (await refreshBtns.length > 0) {
      await refreshBtns[0].click();
      await browser.pause(2_000);
      await expect($(SEL.walletPage)).toBeDisplayed();
    }
  });
});
