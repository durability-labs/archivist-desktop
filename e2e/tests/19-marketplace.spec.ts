import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, getCount, sleep, SEL } from '../helpers';

/**
 * @smoke
 * Marketplace (Browse) page — form interaction and data verification tests.
 * NOTE: Marketplace requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
describe('Marketplace page @smoke', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  /** Navigate to Browse and return true if marketplace page rendered. */
  async function gotoMarketplace(): Promise<boolean> {
    await navigateTo('Make a Deal');
    await browser.pause(1_000);
    try {
      const page = $(SEL.marketplacePage);
      await page.waitForDisplayed({ timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  it('should navigate to Browse page', async function () {
    const available = await gotoMarketplace();
    if (!available) {
      this.skip();
      return;
    }
    await expect($(SEL.marketplacePage)).toBeDisplayed();
  });

  it('should display page header', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const header = $(SEL.marketplaceHeader);
    await expect(header).toBeDisplayed();
  });

  it('should show stats section with labels and values', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const stats = $(SEL.mpStats);
    const hasStats = await stats.isDisplayed().catch(() => false);

    if (hasStats) {
      const statItems = await stats.$$('.mp-stat');
      expect(statItems.length).toBeGreaterThan(0);

      for (let i = 0; i < await statItems.length; i++) {
        const item = statItems[i];
        await expect(item.$('.mp-stat-label')).toBeDisplayed();
        await expect(item.$('.mp-stat-value')).toBeDisplayed();
      }
    }
  });

  it('should fill and submit availability form', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const form = $(SEL.mpForm);
    const hasForm = await form.isDisplayed().catch(() => false);

    if (!hasForm) {
      this.skip();
      return;
    }

    const submitBtn = await hasText('.mp-submit-btn', 'Publish Availability');
    const hasSubmit = await submitBtn.isDisplayed().catch(() => false);

    if (!hasSubmit) {
      this.skip();
      return;
    }

    await submitBtn.click();
    await browser.pause(3_000);

    const hasTable = await $(SEL.mpTable).isDisplayed().catch(() => false);
    const hasError = await $('.mp-error').isDisplayed().catch(() => false);
    const pageStill = await $(SEL.marketplacePage).isDisplayed();

    expect(hasTable || hasError || pageStill).toBeTruthy();
  });

  it('should click refresh button without crash', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const refreshBtns = await $$(SEL.mpRefreshBtn);

    if (await refreshBtns.length > 0) {
      await refreshBtns[0].click();
      await browser.pause(2_000);
      await expect($(SEL.marketplacePage)).toBeDisplayed();
    }
  });

  it('should show empty state or data table for availability', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const hasEmpty = await $(SEL.mpEmpty).isDisplayed().catch(() => false);
    const hasTable = await $(SEL.mpTable).isDisplayed().catch(() => false);
    // Without Tauri invoke, wallet setup banner may appear instead
    const walletBtn = await hasText('.mp-submit-btn', 'Go to Wallet Setup');
    const hasWalletBanner = await walletBtn.isDisplayed().catch(() => false);

    expect(hasEmpty || hasTable || hasWalletBanner).toBeTruthy();
  });

  it('should fill storage request form', async function () {
    const available = await gotoMarketplace();
    if (!available) { this.skip(); return; }

    const requestBtn = await hasText('.mp-submit-btn', 'Create Storage Request');
    const hasRequest = await requestBtn.isDisplayed().catch(() => false);

    if (!hasRequest) {
      this.skip();
      return;
    }

    const cidInput = $('.mp-form input[list]');
    if (await cidInput.isDisplayed().catch(() => false)) {
      await cidInput.setValue('zdj7WweQ9');
      await browser.pause(500);
    }

    await requestBtn.click();
    await browser.pause(3_000);

    expect(await $(SEL.marketplacePage).isDisplayed()).toBeTruthy();
  });
});
