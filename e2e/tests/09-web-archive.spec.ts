import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

// Use 09 to avoid collision with 08-media-download.spec.ts
test.describe('Web Archive page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display Web Archive page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(500);

      const header = page.locator(SEL.webArchiveHeader);
      await expect(header).toHaveText('Web Archive');

      const urlInput = page.locator(SEL.archiveUrlInput);
      await expect(urlInput).toBeVisible();

      const archiveBtn = page.locator(SEL.archiveBtn);
      await expect(archiveBtn).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should have Archive button disabled when URL is empty', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(500);

      const archiveBtn = page.locator(SEL.archiveBtn);
      await expect(archiveBtn).toBeDisabled();
    } finally {
      await browser.close();
    }
  });

  test('should show empty state when no archives exist', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(500);

      // Should show either empty state or existing archives
      const emptyState = page.locator('.web-archive-page .empty-state');
      const archivedSection = page.locator('.web-archive-page .archived-section');
      const taskList = page.locator('.web-archive-page .task-list');

      const hasEmpty = await emptyState.isVisible().catch(() => false);
      const hasArchived = await archivedSection.isVisible().catch(() => false);
      const hasTasks = await taskList.isVisible().catch(() => false);

      // At least one of these should be visible
      expect(hasEmpty || hasArchived || hasTasks).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show crawl settings when toggled', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(500);

      // Click settings toggle
      const settingsToggle = page.locator('.web-archive-page .settings-toggle');
      await expect(settingsToggle).toBeVisible();
      await settingsToggle.click();
      await page.waitForTimeout(300);

      // Settings should now be visible
      const crawlSettings = page.locator('.web-archive-page .crawl-settings');
      await expect(crawlSettings).toBeVisible();

      // Verify settings fields exist
      const maxDepthInput = crawlSettings.locator('input[type="number"]').first();
      await expect(maxDepthInput).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should queue an archive of ethresear.ch', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(500);

      // Open settings to set max depth and pages for faster CI runs
      const settingsToggle = page.locator('.web-archive-page .settings-toggle');
      await settingsToggle.click();
      await page.waitForTimeout(300);

      // Set max depth to 1 and max pages to 5
      const numberInputs = page.locator('.web-archive-page .crawl-settings input[type="number"]');
      const maxDepthInput = numberInputs.first();
      const maxPagesInput = numberInputs.nth(1);

      await maxDepthInput.fill('1');
      await maxPagesInput.fill('5');

      // Enter test URL
      const urlInput = page.locator(SEL.archiveUrlInput);
      await urlInput.fill(
        'https://ethresear.ch/t/peerdas-a-simpler-das-approach-using-battle-tested-p2p-components/16541'
      );

      // Click Archive
      const archiveBtn = page.locator(SEL.archiveBtn);
      await expect(archiveBtn).toBeEnabled();
      await archiveBtn.click();

      // Verify task appears in queue
      await page.waitForTimeout(1000);
      const taskCard = page.locator(SEL.archiveTaskCard).first();
      await expect(taskCard).toBeVisible({ timeout: 5000 });

      // Verify badge shows Queued or Crawling
      const badge = taskCard.locator('.task-badge');
      const badgeText = await badge.textContent();
      expect(
        badgeText?.includes('Queued') ||
        badgeText?.includes('Crawling') ||
        badgeText?.includes('Downloading') ||
        badgeText?.includes('Packaging') ||
        badgeText?.includes('Uploading')
      ).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should complete the archive', async () => {
    const { browser, page } = await connectToApp();
    test.setTimeout(180_000); // 3 minutes for crawling + upload
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(1000);

      // Wait for a task to reach completed state (up to 120s)
      const completedBadge = page.locator('.web-archive-page .task-badge.badge-success');
      await expect(completedBadge).toBeVisible({ timeout: 120_000 });

      // Verify CID is displayed
      const resultCid = page.locator('.web-archive-page .result-cid').first();
      await expect(resultCid).toBeVisible();
      const cid = await resultCid.textContent();
      expect(cid).toBeTruthy();
      expect(cid!.length).toBeGreaterThan(10);
    } finally {
      await browser.close();
    }
  });

  test('should show archived site in history', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(1000);

      // Verify the archived sites section shows an entry
      const archivedItem = page.locator(SEL.archivedItem).first();
      await expect(archivedItem).toBeVisible({ timeout: 5000 });

      // Verify it shows page count
      const meta = archivedItem.locator('.archived-meta');
      const metaText = await meta.textContent();
      expect(metaText).toContain('pages');
    } finally {
      await browser.close();
    }
  });

  test('should open archive viewer and display content', async () => {
    const { browser, page } = await connectToApp();
    test.setTimeout(60_000);
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(1000);

      // Click Browse on the first archived item or completed task
      const browseBtn = page.locator(SEL.browseBtn).first();
      await expect(browseBtn).toBeVisible({ timeout: 5000 });
      await browseBtn.click();

      // Wait for viewer panel to appear
      const viewerPanel = page.locator(SEL.viewerPanel);
      await expect(viewerPanel).toBeVisible({ timeout: 30_000 });

      // Verify iframe exists and has the right src
      const iframe = page.locator(SEL.viewerIframe);
      await expect(iframe).toBeVisible();
      const src = await iframe.getAttribute('src');
      expect(src).toContain('http://127.0.0.1:8088');
    } finally {
      await browser.close();
    }
  });

  test('should have working close button on viewer', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Web Archive');
      await page.waitForTimeout(1000);

      // Check if viewer is currently open
      const viewerPanel = page.locator(SEL.viewerPanel);
      const isViewerOpen = await viewerPanel.isVisible().catch(() => false);

      if (isViewerOpen) {
        // Click close
        const closeBtn = page.locator(SEL.viewerCloseBtn);
        await expect(closeBtn).toBeVisible();
        await closeBtn.click();
        await page.waitForTimeout(500);

        // Verify viewer is gone
        await expect(viewerPanel).not.toBeVisible();
      }

      // Verify the archive list is visible
      const archivePage = page.locator(SEL.webArchivePage);
      await expect(archivePage).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
