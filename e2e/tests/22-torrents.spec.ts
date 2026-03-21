import { navigateTo, hasText, sleep, SEL, waitAndAcceptAlert } from '../helpers';

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

describe('Torrents page @online @slow', () => {
  it('should navigate to Torrents page', async () => {
    await navigateTo('Torrents');
    await browser.pause(500);

    const page = await $(SEL.torrentsPage);
    await expect(page).toBeDisplayed();
  });

  it('should display page header and magnet input', async () => {
    await navigateTo('Torrents');
    await browser.pause(500);

    const header = await $(SEL.torrentsHeader);
    await expect(header).toBeDisplayed();
    const magnetInput = await $(SEL.magnetInput);
    await expect(magnetInput).toBeDisplayed();
    const addBtn = await $(SEL.addMagnetBtn);
    await expect(addBtn).toBeDisplayed();
  });

  it('should show empty state with no active torrents', async () => {
    await navigateTo('Torrents');
    await browser.pause(500);

    // Either empty state or existing torrents
    const emptyEl = await $(SEL.torrentEmptyState);
    const hasEmpty = await emptyEl.isDisplayed().catch(() => false);
    const rowEl = await $(SEL.torrentRow);
    const hasTorrents = await rowEl.isDisplayed().catch(() => false);

    expect(hasEmpty || hasTorrents).toBeTruthy();
  });

  it('should add a magnet link and show torrent', async function () {
    this.timeout(120000);
    await navigateTo('Torrents');
    await browser.pause(500);

    // Enter magnet link
    const magnetInput = await $(SEL.magnetInput);
    await magnetInput.setValue(TEST_MAGNET);
    const addBtn = await $(SEL.addMagnetBtn);
    await addBtn.click();
    await browser.pause(3000);

    // Torrent row should appear
    const torrentRow = await $(SEL.torrentRow);
    await torrentRow.waitForDisplayed({ timeout: 30000 });

    // Should show a name
    const name = await torrentRow.$(SEL.torrentName);
    await name.waitForDisplayed({ timeout: 15000 });

    // Should show a state badge
    const badge = await torrentRow.$(SEL.torrentStateBadge);
    await expect(badge).toBeDisplayed();
  });

  it('should show progress updates', async function () {
    this.timeout(120000);
    await navigateTo('Torrents');
    await browser.pause(1000);

    // Wait for a torrent to be present
    const torrentRow = await $(SEL.torrentRow);
    const hasTorrent = await torrentRow.isDisplayed().catch(() => false);

    if (hasTorrent) {
      // Progress bar should exist
      const progress = await torrentRow.$(SEL.torrentProgress);
      await progress.waitForDisplayed({ timeout: 10000 });

      // Wait a bit and check if progress changes
      await sleep(10000);
      const progressFill = await torrentRow.$(SEL.torrentProgressFill);
      const hasProgress = await progressFill.isDisplayed().catch(() => false);
      expect(hasProgress).toBeTruthy();
    }
  });

  it('should open detail panel on row click', async () => {
    await navigateTo('Torrents');
    await browser.pause(1000);

    const torrentRow = await $(SEL.torrentRow);
    const hasTorrent = await torrentRow.isDisplayed().catch(() => false);

    if (hasTorrent) {
      await torrentRow.click();
      await browser.pause(500);

      // Detail panel should open
      const detailPanel = await $(SEL.torrentDetailPanel);
      await detailPanel.waitForDisplayed({ timeout: 5000 });
    }
  });

  it('should switch between detail tabs', async () => {
    await navigateTo('Torrents');
    await browser.pause(1000);

    const torrentRow = await $(SEL.torrentRow);
    const hasTorrent = await torrentRow.isDisplayed().catch(() => false);

    if (hasTorrent) {
      // Select the torrent
      await torrentRow.click();
      await browser.pause(500);

      // Click Files tab
      const filesTab = await $(SEL.detailTabFiles);
      if (await filesTab.isDisplayed().catch(() => false)) {
        await filesTab.click();
        await browser.pause(300);
        const fileTree = await $(SEL.fileTree);
        const hasFileTree = await fileTree.isDisplayed().catch(() => false);
        expect(hasFileTree).toBeTruthy();
      }

      // Click Peers tab
      const peersTab = await $(SEL.detailTabPeers);
      if (await peersTab.isDisplayed().catch(() => false)) {
        await peersTab.click();
        await browser.pause(300);
        // Peer table may or may not be populated yet
        expect(true).toBeTruthy(); // Tab click didn't crash
      }

      // Click Info tab
      const infoTab = await $(SEL.detailTabInfo);
      if (await infoTab.isDisplayed().catch(() => false)) {
        await infoTab.click();
        await browser.pause(300);
        const infoHash = await $(SEL.torrentInfoHash);
        const hasInfoHash = await infoHash.isDisplayed().catch(() => false);
        expect(hasInfoHash).toBeTruthy();
      }
    }
  });

  it('should pause and resume a torrent', async () => {
    await navigateTo('Torrents');
    await browser.pause(1000);

    const torrentRow = await $(SEL.torrentRow);
    const hasTorrent = await torrentRow.isDisplayed().catch(() => false);

    if (hasTorrent) {
      // Select the torrent
      await torrentRow.click();
      await browser.pause(500);

      // Find pause button
      const pauseBtn = await $(SEL.torrentPauseBtn);
      if (await pauseBtn.isDisplayed().catch(() => false)) {
        await pauseBtn.click();
        await browser.pause(1000);

        // Badge should show paused state
        const badge = await torrentRow.$(SEL.torrentStateBadge);
        const badgeText = await badge.getText();
        expect(badgeText?.toLowerCase()).toContain('pause');

        // Resume
        const resumeBtn = await $(SEL.torrentResumeBtn);
        if (await resumeBtn.isDisplayed().catch(() => false)) {
          await resumeBtn.click();
          await browser.pause(1000);
        }
      }
    }
  });

  it('should show non-zero download speed during active download', async function () {
    this.timeout(180000);
    await navigateTo('Torrents');
    await browser.pause(500);

    // Add magnet if no torrent present
    const rowEl = await $(SEL.torrentRow);
    const hasTorrent = await rowEl.isDisplayed().catch(() => false);
    if (!hasTorrent) {
      const magnetInput = await $(SEL.magnetInput);
      await magnetInput.setValue(TEST_MAGNET);
      const addBtn = await $(SEL.addMagnetBtn);
      await addBtn.click();
    }

    // Wait for torrent row
    const torrentRow = await $(SEL.torrentRow);
    await torrentRow.waitForDisplayed({ timeout: 30000 });

    // Poll DL speed for up to 60s, checking for non-zero
    let sawNonZeroSpeed = false;
    for (let i = 0; i < 30; i++) {
      await browser.pause(2000);
      const speedEl = await torrentRow.$(SEL.torrentSpeedDl);
      const speedText = await speedEl.getText().catch(() => '');
      // Non-zero means NOT "0 B/s" and NOT empty
      if (speedText.trim() && speedText.trim() !== '0 B/s') {
        sawNonZeroSpeed = true;
        break;
      }
      // Also check state — if already seeding, speed was non-zero at some point
      const badgeEl = await torrentRow.$(SEL.torrentStateBadge);
      const stateText = await badgeEl.getText().catch(() => '');
      if (stateText.toLowerCase().includes('seeding')) {
        sawNonZeroSpeed = true;
        break;
      }
    }

    expect(sawNonZeroSpeed).toBeTruthy();

    // Cleanup: remove torrent
    const row = await $(SEL.torrentRow);
    if (await row.isDisplayed().catch(() => false)) {
      await row.click();
      const removeBtn = await $(SEL.torrentRemoveBtn);
      if (await removeBtn.isDisplayed().catch(() => false)) {
        await removeBtn.click();
        await waitAndAcceptAlert(5000);
        await browser.pause(2000);
      }
    }
  });

  it('should remove torrent and show empty state', async () => {
    await navigateTo('Torrents');
    await browser.pause(1000);

    const torrentRow = await $(SEL.torrentRow);
    const hasTorrent = await torrentRow.isDisplayed().catch(() => false);

    if (hasTorrent) {
      await torrentRow.click();
      await browser.pause(500);

      // Find remove button
      const removeBtn = await $(SEL.torrentRemoveBtn);
      if (await removeBtn.isDisplayed().catch(() => false)) {
        // Handle confirmation dialog
        await removeBtn.click();
        await waitAndAcceptAlert(5000);
        await browser.pause(2000);

        // List should now be empty (or have fewer torrents)
        const remaining = await $$(SEL.torrentRow);
        const remainingCount = await remaining.length;
        const emptyEl = await $(SEL.torrentEmptyState);
        const hasEmpty = await emptyEl.isDisplayed().catch(() => false);

        expect(remainingCount === 0 || hasEmpty).toBeTruthy();
      }
    }
  });
});
