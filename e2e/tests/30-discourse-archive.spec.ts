import { navigateTo, SEL } from '../helpers';

/**
 * @online — requires internet access to reach a live Discourse forum
 *
 * Discourse forum archive end-to-end test.
 *
 * On Windows (WebView2 with CDP), these tests interact with the full UI.
 * The backend integration test (cargo test --test discourse_integration)
 * covers the scrape → build → ZIP → upload pipeline on all platforms.
 */
describe('Discourse forum archive (end-to-end)', () => {
  it('should detect Discourse forum and show settings', async function () {
    this.timeout(60000);

    await navigateTo('Website Scraper');
    await browser.pause(500);

    // 1. Enter the Discourse forum URL
    const urlInput = await $(SEL.archiveUrlInput);
    await urlInput.setValue('https://forums.theanimenetwork.com');

    // 2. Trigger blur to start Discourse detection
    await browser.execute(() => (document.activeElement as HTMLElement)?.blur());

    // 3. Wait for Discourse detection badge
    const detectedBadge = await $('.discourse-badge.detected');
    await detectedBadge.waitForDisplayed({ timeout: 15000 });
    await expect(detectedBadge).toHaveText('Discourse forum detected');

    // 4. Verify "Forum Archive Mode" checkbox is auto-checked
    const forumModeCheckbox = await $('.mode-toggles .single-page-toggle input[type="checkbox"]');
    expect(await forumModeCheckbox.isSelected()).toBe(true);

    // 5. Open forum settings and verify they're visible
    const settingsToggle = await $('.web-archive-page .settings-toggle');
    await settingsToggle.click();
    await browser.pause(300);

    const forumSettings = await $('.forum-settings');
    await expect(forumSettings).toBeDisplayed();

    // Verify forum-specific settings exist
    const maxTopicsInput = await forumSettings.$('input[type="number"]');
    await expect(maxTopicsInput).toBeDisplayed();
  });

  it('should archive a Discourse forum end-to-end', async function () {
    this.timeout(300000); // 5 minutes — forum scraping is slow

    await navigateTo('Website Scraper');
    await browser.pause(500);

    // 1. Enter the Discourse forum URL
    const urlInput = await $(SEL.archiveUrlInput);
    await urlInput.setValue('https://forums.theanimenetwork.com');

    // 2. Trigger blur → wait for Discourse detection
    await browser.execute(() => (document.activeElement as HTMLElement)?.blur());
    const detectedBadge = await $('.discourse-badge.detected');
    await detectedBadge.waitForDisplayed({ timeout: 15000 });

    // 3. Open forum settings, set max topics to 5 (for speed)
    const settingsToggle = await $('.web-archive-page .settings-toggle');
    await settingsToggle.click();
    await browser.pause(300);

    const forumSettings = await $('.forum-settings');
    const maxTopicsInput = await forumSettings.$('input[type="number"]');
    await maxTopicsInput.setValue('5');

    // 4. Click Archive button
    const archiveBtn = await $(SEL.archiveBtn);
    await expect(archiveBtn).toBeEnabled();
    await archiveBtn.click();

    // 5. Wait for task card to appear
    const taskCard = await $(SEL.archiveTaskCard);
    await taskCard.waitForDisplayed({ timeout: 10000 });

    // Verify initial state is Crawling (or Queued briefly)
    const badge = await taskCard.$('.task-badge');
    const badgeText = await badge.getText();
    expect(
      badgeText?.includes('Queued') ||
      badgeText?.includes('Crawling') ||
      badgeText?.includes('Downloading')
    ).toBeTruthy();

    // 6. Wait for completion (up to 4 minutes)
    const completedBadge = await $('.web-archive-page .task-badge.badge-success');
    await completedBadge.waitForDisplayed({ timeout: 240000 });

    // 7. Verify completed task shows local file path
    const resultPath = await $('.web-archive-page .result-path');
    await resultPath.waitForDisplayed({ timeout: 5000 });
    const pathText = await resultPath.getText();
    expect(pathText).toBeTruthy();
    expect(pathText!.toLowerCase()).toContain('discourse');

    // 8. Take a screenshot for confirmation
    await browser.saveScreenshot('e2e/screenshots/discourse-archive-complete.png');
  });

  it('should show archived forum in history with upload option', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(2000);

    // Verify the archived sites section shows a Discourse entry
    const archivedItem = await $(SEL.archivedItem);
    await archivedItem.waitForDisplayed({ timeout: 5000 });

    // Verify it shows page count
    const meta = await archivedItem.$('.archived-meta');
    const metaText = await meta.getText();
    expect(metaText).toContain('pages');

    // Local-only archives should have an "Upload to Node" button
    const uploadBtn = await archivedItem.$('.upload-btn');
    const browseBtn = await archivedItem.$('.browse-btn');

    // Either upload (local-only) or browse (already uploaded) should be available
    const hasUpload = await uploadBtn.isDisplayed().catch(() => false);
    const hasBrowse = await browseBtn.isDisplayed().catch(() => false);
    expect(hasUpload || hasBrowse).toBeTruthy();
  });
});
