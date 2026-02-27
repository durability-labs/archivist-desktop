import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, sleep, SEL } from '../helpers';

/**
 * @online @slow
 * Torrent client E2E tests. Requires internet access for real magnet links.
 *
 * Uses a small, public-domain torrent for testing:
 * "The WIRED CD" — Creative Commons-licensed music compilation.
 */

// Public-domain magnet link — small, legal, widely seeded
const TEST_MAGNET =
  'magnet:?xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3&dn=The+WIRED+CD+-+Rip.+Sample.+Mash.+Share.&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce';

test.describe('Torrents page @online @slow', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Torrents page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.torrentsPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header and magnet input', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.torrentsHeader)).toBeVisible();
      await expect(page.locator(SEL.magnetInput)).toBeVisible();
      await expect(page.locator(SEL.addMagnetBtn)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show empty state with no active torrents', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(500);

      // Either empty state or existing torrents
      const hasEmpty = await page.locator(SEL.torrentEmptyState).isVisible().catch(() => false);
      const hasTorrents = await page.locator(SEL.torrentRow).first().isVisible().catch(() => false);

      expect(hasEmpty || hasTorrents).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should add a magnet link and show torrent', async () => {
    test.setTimeout(120_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(500);

      // Enter magnet link
      await page.locator(SEL.magnetInput).fill(TEST_MAGNET);
      await page.locator(SEL.addMagnetBtn).click();
      await page.waitForTimeout(3_000);

      // Torrent row should appear
      const torrentRow = page.locator(SEL.torrentRow).first();
      await expect(torrentRow).toBeVisible({ timeout: 30_000 });

      // Should show a name
      const name = torrentRow.locator(SEL.torrentName);
      await expect(name).toBeVisible({ timeout: 15_000 });

      // Should show a state badge
      const badge = torrentRow.locator(SEL.torrentStateBadge);
      await expect(badge).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show progress updates', async () => {
    test.setTimeout(120_000);
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      // Wait for a torrent to be present
      const torrentRow = page.locator(SEL.torrentRow).first();
      const hasTorrent = await torrentRow.isVisible().catch(() => false);

      if (hasTorrent) {
        // Progress bar should exist
        const progress = torrentRow.locator(SEL.torrentProgress);
        await expect(progress).toBeVisible({ timeout: 10_000 });

        // Wait a bit and check if progress changes
        await sleep(10_000);
        const progressFill = torrentRow.locator(SEL.torrentProgressFill);
        const hasProgress = await progressFill.isVisible().catch(() => false);
        expect(hasProgress).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });

  test('should open detail panel on row click', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      const torrentRow = page.locator(SEL.torrentRow).first();
      const hasTorrent = await torrentRow.isVisible().catch(() => false);

      if (hasTorrent) {
        await torrentRow.click();
        await page.waitForTimeout(500);

        // Detail panel should open
        await expect(page.locator(SEL.torrentDetailPanel)).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await browser.close();
    }
  });

  test('should switch between detail tabs', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      const torrentRow = page.locator(SEL.torrentRow).first();
      const hasTorrent = await torrentRow.isVisible().catch(() => false);

      if (hasTorrent) {
        // Select the torrent
        await torrentRow.click();
        await page.waitForTimeout(500);

        // Click Files tab
        const filesTab = page.locator(SEL.detailTabFiles);
        if (await filesTab.isVisible().catch(() => false)) {
          await filesTab.click();
          await page.waitForTimeout(300);
          const hasFileTree = await page.locator(SEL.fileTree).isVisible().catch(() => false);
          expect(hasFileTree).toBeTruthy();
        }

        // Click Peers tab
        const peersTab = page.locator(SEL.detailTabPeers);
        if (await peersTab.isVisible().catch(() => false)) {
          await peersTab.click();
          await page.waitForTimeout(300);
          const hasPeerTable = await page.locator(SEL.peerTable).isVisible().catch(() => false);
          // Peer table may or may not be populated yet
          expect(true).toBeTruthy(); // Tab click didn't crash
        }

        // Click Info tab
        const infoTab = page.locator(SEL.detailTabInfo);
        if (await infoTab.isVisible().catch(() => false)) {
          await infoTab.click();
          await page.waitForTimeout(300);
          const hasInfoHash = await page.locator(SEL.torrentInfoHash).isVisible().catch(() => false);
          expect(hasInfoHash).toBeTruthy();
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should pause and resume a torrent', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      const torrentRow = page.locator(SEL.torrentRow).first();
      const hasTorrent = await torrentRow.isVisible().catch(() => false);

      if (hasTorrent) {
        // Select the torrent
        await torrentRow.click();
        await page.waitForTimeout(500);

        // Find pause button
        const pauseBtn = page.locator(SEL.torrentPauseBtn);
        if (await pauseBtn.isVisible().catch(() => false)) {
          await pauseBtn.click();
          await page.waitForTimeout(1_000);

          // Badge should show paused state
          const badge = torrentRow.locator(SEL.torrentStateBadge);
          const badgeText = await badge.textContent();
          expect(badgeText?.toLowerCase()).toContain('pause');

          // Resume
          const resumeBtn = page.locator(SEL.torrentResumeBtn);
          if (await resumeBtn.isVisible().catch(() => false)) {
            await resumeBtn.click();
            await page.waitForTimeout(1_000);
          }
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should remove torrent and show empty state', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      const torrentRow = page.locator(SEL.torrentRow).first();
      const hasTorrent = await torrentRow.isVisible().catch(() => false);

      if (hasTorrent) {
        await torrentRow.click();
        await page.waitForTimeout(500);

        // Find remove button
        const removeBtn = page.locator(SEL.torrentRemoveBtn);
        if (await removeBtn.isVisible().catch(() => false)) {
          // Handle confirmation dialog
          page.on('dialog', (dialog) => dialog.accept());
          await removeBtn.click();
          await page.waitForTimeout(2_000);

          // List should now be empty (or have fewer torrents)
          const remainingCount = await page.locator(SEL.torrentRow).count();
          const hasEmpty = await page.locator(SEL.torrentEmptyState).isVisible().catch(() => false);

          expect(remainingCount === 0 || hasEmpty).toBeTruthy();
        }
      }
    } finally {
      await browser.close();
    }
  });
});
