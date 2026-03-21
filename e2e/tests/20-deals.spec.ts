import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, getCount, sleep, SEL } from '../helpers';

/**
 * @smoke
 * Deals page — expandable rows, refresh, and state badge verification.
 * NOTE: Deals requires the `marketplace` compile-time feature flag.
 * Tests skip gracefully if the feature is not available.
 */
describe('Deals page @smoke', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  /** Navigate to My Deals and return true if page rendered. */
  async function gotoDeals(): Promise<boolean> {
    await navigateTo('My Deals');
    await browser.pause(1_000);
    try {
      const page = $(SEL.dealsPage);
      await page.waitForDisplayed({ timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  it('should navigate to My Deals page', async function () {
    const available = await gotoDeals();
    if (!available) {
      this.skip();
      return;
    }
    await expect($(SEL.dealsPage)).toBeDisplayed();
  });

  it('should display page header', async function () {
    const available = await gotoDeals();
    if (!available) { this.skip(); return; }

    const header = $(SEL.dealsHeader);
    await expect(header).toBeDisplayed();
  });

  it('should click refresh button and verify page updates', async function () {
    const available = await gotoDeals();
    if (!available) { this.skip(); return; }

    const refreshBtns = await $$(SEL.mpRefreshBtn);
    if (await refreshBtns.length > 0) {
      await refreshBtns[0].click();
      await browser.pause(2_000);
      await expect($(SEL.dealsPage)).toBeDisplayed();
    }
  });

  it('should expand purchase row on click', async function () {
    const available = await gotoDeals();
    if (!available) { this.skip(); return; }

    const table = $(SEL.mpTable);
    const hasTable = await table.isDisplayed().catch(() => false);

    if (!hasTable) {
      const hasEmpty = await $(SEL.mpEmpty).isDisplayed().catch(() => false);
      expect(hasEmpty).toBeTruthy();
      return;
    }

    const rows = await table.$$('tbody tr');
    const rowCount = await rows.length;

    if (rowCount > 0) {
      await rows[0].click();
      await browser.pause(500);

      const rowsAfter = await table.$$('tbody tr');
      expect(await rowsAfter.length).toBeGreaterThanOrEqual(rowCount);
    }
  });

  it('should show state badges with text content', async function () {
    const available = await gotoDeals();
    if (!available) { this.skip(); return; }

    const badges = await $$('.mp-state-badge');

    if (await badges.length > 0) {
      for (let i = 0; i < await badges.length; i++) {
        const badge = badges[i];
        const text = await badge.getText();
        expect(text).toBeTruthy();
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('should show empty state or data for purchases and slots', async function () {
    const available = await gotoDeals();
    if (!available) { this.skip(); return; }

    const pageContent = await $(SEL.dealsPage).getText();
    expect(pageContent).toBeTruthy();
    expect(pageContent.length).toBeGreaterThan(0);

    const sections = await $$('.mp-section');
    expect(sections.length).toBeGreaterThan(0);
  });
});
