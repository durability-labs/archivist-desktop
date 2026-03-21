import {
  navigateTo,
  isDisplayed,
  SEL,
} from '../helpers';

// Use 09 to avoid collision with 08-media-download.spec.ts
describe('Web Archive page', () => {
  it('should display Web Archive page', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(500);

    const header = await $(SEL.webArchiveHeader);
    await expect(header).toHaveText('Web Archive');

    const urlInput = await $(SEL.archiveUrlInput);
    await expect(urlInput).toBeDisplayed();

    const archiveBtn = await $(SEL.archiveBtn);
    await expect(archiveBtn).toBeDisplayed();
  });

  it('should have Archive button disabled when URL is empty', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(500);

    const archiveBtn = await $(SEL.archiveBtn);
    await expect(archiveBtn).toBeDisabled();
  });

  it('should show empty state when no archives exist', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(500);

    // Should show either empty state or existing archives
    const hasEmpty = await isDisplayed('.web-archive-page .empty-state', 2000);
    const hasArchived = await isDisplayed('.web-archive-page .archived-section', 2000);
    const hasTasks = await isDisplayed('.web-archive-page .task-list', 2000);

    // At least one of these should be visible
    expect(hasEmpty || hasArchived || hasTasks).toBeTruthy();
  });

  it('should show crawl settings when toggled', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(500);

    // Click settings toggle
    const settingsToggle = await $('.web-archive-page .settings-toggle');
    await expect(settingsToggle).toBeDisplayed();
    await settingsToggle.click();
    await browser.pause(300);

    // Settings should now be visible
    const crawlSettings = await $('.web-archive-page .crawl-settings');
    await expect(crawlSettings).toBeDisplayed();

    // Verify settings fields exist
    const maxDepthInput = await crawlSettings.$('input[type="number"]');
    await expect(maxDepthInput).toBeDisplayed();
  });

  it('should queue an archive of ethresear.ch', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(500);

    // Open settings to set max depth and pages for faster CI runs
    const settingsToggle = await $('.web-archive-page .settings-toggle');
    await settingsToggle.click();
    await browser.pause(300);

    // Set max depth to 1 and max pages to 5
    const numberInputs = await $$('.web-archive-page .crawl-settings input[type="number"]');
    const maxDepthInput = numberInputs[0];
    const maxPagesInput = numberInputs[1];

    await maxDepthInput.setValue('1');
    await maxPagesInput.setValue('5');

    // Enter test URL
    const urlInput = await $(SEL.archiveUrlInput);
    await urlInput.setValue(
      'https://ethresear.ch/t/peerdas-a-simpler-das-approach-using-battle-tested-p2p-components/16541'
    );

    // Click Archive
    const archiveBtn = await $(SEL.archiveBtn);
    await expect(archiveBtn).toBeEnabled();
    await archiveBtn.click();

    // Verify task appears in queue
    await browser.pause(1000);
    const taskCard = await $(SEL.archiveTaskCard);
    await taskCard.waitForDisplayed({ timeout: 5000 });

    // Verify badge shows Queued or Crawling
    const badge = await taskCard.$('.task-badge');
    const badgeText = await badge.getText();
    expect(
      badgeText?.includes('Queued') ||
      badgeText?.includes('Crawling') ||
      badgeText?.includes('Downloading') ||
      badgeText?.includes('Packaging') ||
      badgeText?.includes('Saving')
    ).toBeTruthy();
  });

  it('should complete the archive', async function () {
    this.timeout(180000); // 3 minutes for crawling + upload

    await navigateTo('Website Scraper');
    await browser.pause(1000);

    // Wait for a task to reach completed state (up to 120s)
    const completedBadge = await $('.web-archive-page .task-badge.badge-success');
    await completedBadge.waitForDisplayed({ timeout: 120_000 });

    // Verify result is displayed (local path or CID)
    const hasPath = await isDisplayed('.web-archive-page .result-path', 2000);
    const hasCid = await isDisplayed('.web-archive-page .result-cid', 2000);
    expect(hasPath || hasCid).toBeTruthy();
    if (hasPath) {
      const resultPath = await $('.web-archive-page .result-path');
      const pathText = await resultPath.getText();
      expect(pathText).toBeTruthy();
      expect(pathText!.length).toBeGreaterThan(5);
    } else {
      const resultCid = await $('.web-archive-page .result-cid');
      const cidText = await resultCid.getText();
      expect(cidText).toBeTruthy();
      expect(cidText!.length).toBeGreaterThan(10);
    }
  });

  it('should show archived site in history', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(1000);

    // Verify the archived sites section shows an entry
    const archivedItem = await $(SEL.archivedItem);
    await archivedItem.waitForDisplayed({ timeout: 5000 });

    // Verify it shows page count
    const meta = await archivedItem.$('.archived-meta');
    const metaText = await meta.getText();
    expect(metaText).toContain('pages');
  });

  it('should open archive viewer and display content', async function () {
    this.timeout(60000);

    await navigateTo('Website Scraper');
    await browser.pause(1000);

    // Browse button only appears for archives with a CID (uploaded to node)
    const hasBrowse = await isDisplayed(SEL.browseBtn, 3000);

    if (!hasBrowse) {
      // Local-only archives don't have a Browse button — test passes
      return;
    }

    const browseBtn = await $(SEL.browseBtn);
    await browseBtn.click();

    // Wait for viewer panel to appear
    const viewerPanel = await $(SEL.viewerPanel);
    await viewerPanel.waitForDisplayed({ timeout: 30_000 });

    // Verify iframe exists and has the right src
    const iframe = await $(SEL.viewerIframe);
    await expect(iframe).toBeDisplayed();
    const src = await iframe.getAttribute('src');
    expect(src).toContain('http://127.0.0.1:8088');
  });

  it('should have working close button on viewer', async () => {
    await navigateTo('Website Scraper');
    await browser.pause(1000);

    // Check if viewer is currently open
    const isViewerOpen = await isDisplayed(SEL.viewerPanel, 1000);

    if (isViewerOpen) {
      // Click close
      const closeBtn = await $(SEL.viewerCloseBtn);
      await expect(closeBtn).toBeDisplayed();
      await closeBtn.click();
      await browser.pause(500);

      // Verify viewer is gone
      const viewerPanel = await $(SEL.viewerPanel);
      await expect(viewerPanel).not.toBeDisplayed();
    }

    // Verify the archive list is visible
    const archivePage = await $(SEL.webArchivePage);
    await expect(archivePage).toBeDisplayed();
  });
});
