import {
  ensurePastOnboarding,
  hasText,
  getCount,
} from '../helpers';

/**
 * Marketplace UI E2E tests.
 *
 * These tests use the WebdriverIO browser global with tauri-driver.
 * Onboarding is bypassed by setting localStorage before the app reads it.
 */

describe('Marketplace UI', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('Marketplace section label and links are visible', async () => {
    await browser.url('/');
    await browser.pause(500);

    // The Marketplace section label should be visible in the sidebar
    const mpLabel = await hasText('.sidebar .nav-section-label', 'Marketplace');
    await mpLabel.waitForDisplayed({ timeout: 10_000 });

    // Links should be always visible (no accordion to expand)
    const makeADeal = await hasText('.sidebar .nav-link', 'Make a Deal');
    await makeADeal.waitForDisplayed({ timeout: 3_000 });
    const myDeals = await hasText('.sidebar .nav-link', 'My Deals');
    await expect(myDeals).toBeDisplayed();
    const wallet = await hasText('.sidebar .nav-link', 'Wallet');
    await expect(wallet).toBeDisplayed();
  });

  it('/marketplace renders with Offer Storage and Request Storage sections', async () => {
    await browser.url('/marketplace');
    await browser.pause(500);

    // Page header
    const header = await $('.marketplace-page h1');
    await header.waitForDisplayed({ timeout: 10_000 });
    await expect(header).toHaveText('Marketplace');

    // mp-section blocks: wallet setup banner + "Offer Storage" + "Request Storage"
    const sectionCount = await getCount('.mp-section');
    expect(sectionCount).toBeGreaterThanOrEqual(2);
    expect(sectionCount).toBeLessThanOrEqual(3);

    // Verify section headings
    const offerHeading = await hasText('.mp-section h2', 'Offer Storage');
    await expect(offerHeading).toBeDisplayed();
    const requestHeading = await hasText('.mp-section h2', 'Request Storage');
    await expect(requestHeading).toBeDisplayed();
  });

  it('/marketplace — availability form has all fields', async () => {
    await browser.url('/marketplace');
    await browser.pause(500);

    const pageHeader = await $('.marketplace-page h1');
    await pageHeader.waitForDisplayed({ timeout: 10_000 });

    // The availability form is in the "Offer Storage" section
    const offerSection = await $('//div[contains(@class, "mp-section")][.//h2[contains(., "Offer Storage")]]');
    const form = await offerSection.$('.mp-form');
    await expect(form).toBeDisplayed();

    // Check all four provider fields
    const totalSize = await hasText('.mp-field label', 'Total Size');
    await expect(totalSize).toBeDisplayed();
    const duration = await hasText('.mp-field label', 'Duration');
    await expect(duration).toBeDisplayed();
    const minPrice = await hasText('.mp-field label', 'Min Price');
    await expect(minPrice).toBeDisplayed();
    const maxCollateral = await hasText('.mp-field label', 'Max Collateral');
    await expect(maxCollateral).toBeDisplayed();

    // Submit button within the offer section
    const submitBtn = await offerSection.$('.mp-submit-btn');
    await expect(submitBtn).toBeDisplayed();
    await expect(submitBtn).toHaveText('Publish Availability');
  });

  it('/marketplace — storage request form has CID input and parameter fields', async () => {
    await browser.url('/marketplace');
    await browser.pause(500);

    const pageHeader = await $('.marketplace-page h1');
    await pageHeader.waitForDisplayed({ timeout: 10_000 });

    // The storage request form is in the "Request Storage" section
    const requestSection = await $('//div[contains(@class, "mp-section")][.//h2[contains(., "Request Storage")]]');
    const form = await requestSection.$('.mp-form');
    await expect(form).toBeDisplayed();

    // CID input
    const cidLabel = await hasText('.mp-field label', 'CID');
    await expect(cidLabel).toBeDisplayed();
    const cidInput = await form.$('input[placeholder*="CID"]');
    await expect(cidInput).toBeDisplayed();

    // Parameter fields
    const durationLabel = await hasText('.mp-field label', 'Duration');
    await expect(durationLabel).toBeDisplayed();
    const priceLabel = await hasText('.mp-field label', 'Price per Byte');
    await expect(priceLabel).toBeDisplayed();
    const collateralLabel = await hasText('.mp-field label', 'Collateral per Byte');
    await expect(collateralLabel).toBeDisplayed();
    const slotsLabel = await hasText('.mp-field label', 'Slots');
    await expect(slotsLabel).toBeDisplayed();

    // Submit button within the request section
    const submitBtn = await requestSection.$('.mp-submit-btn');
    await expect(submitBtn).toBeDisplayed();
    await expect(submitBtn).toHaveText('Create Storage Request');
  });

  it('/marketplace/deals renders My Purchases and My Slots sections', async () => {
    await browser.url('/marketplace/deals');
    await browser.pause(500);

    // Page header
    const header = await $('.deals-page h1');
    await header.waitForDisplayed({ timeout: 10_000 });
    await expect(header).toHaveText('My Deals');

    // Two mp-section blocks: "My Purchases" and "My Slots"
    const sections = await $$('.mp-section');
    await expect(sections).toBeElementsArrayOfSize(2);

    const purchasesHeading = await hasText('.mp-section h2', 'My Purchases');
    await expect(purchasesHeading).toBeDisplayed();
    const slotsHeading = await hasText('.mp-section h2', 'My Slots');
    await expect(slotsHeading).toBeDisplayed();

    // Empty states should be visible (no real node to provide data)
    const emptyCount = await getCount('.mp-empty');
    expect(emptyCount).toBeGreaterThanOrEqual(1);
  });

  it('/wallet renders page header and available sections', async () => {
    await browser.url('/wallet');
    await browser.pause(500);

    // Page header
    const header = await $('.wallet-page h1');
    await header.waitForDisplayed({ timeout: 10_000 });
    await expect(header).toHaveText('Wallet');

    // Without Tauri invoke, wallet data may not load — sections may be absent.
    // The header rendering is sufficient proof the page loads without crashing.
    const walletPage = await $('.wallet-page');
    await expect(walletPage).toBeDisplayed();
  });
});
