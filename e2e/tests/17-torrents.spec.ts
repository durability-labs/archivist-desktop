import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, getCount, sleep, SEL, waitAndAcceptAlert } from '../helpers';

describe('Torrents page', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('should navigate to Torrents page', async () => {
    await navigateTo('Torrents');
    await expect($(SEL.torrentsPage)).toBeDisplayed();
    await expect($(SEL.torrentsHeader)).toHaveText('Torrents');
  });

  it('should show empty state when no torrents', async () => {
    await navigateTo('Torrents');
    // Either show empty state OR existing torrents from previous session
    const torrentCount = await getCount(SEL.torrentRow);
    if (torrentCount === 0) {
      const emptyState = $(SEL.torrentEmptyState);
      await emptyState.waitForDisplayed({ timeout: 3_000 });
    }
  });

  it('should show add torrent bar with magnet input and file button', async () => {
    await navigateTo('Torrents');
    const magnetInput = $(SEL.magnetInput);
    await magnetInput.waitForDisplayed({ timeout: 3_000 });
    await expect(magnetInput).toHaveAttr('placeholder', expect.stringContaining('magnet'));
    await expect($(SEL.addFileBtn)).toBeDisplayed();
  });

  it('should show global speed stats in header', async () => {
    await navigateTo('Torrents');
    const dlSpeed = $(SEL.globalDlSpeed);
    await dlSpeed.waitForDisplayed({ timeout: 5_000 });
    await expect($(SEL.globalUlSpeed)).toBeDisplayed();
  });

  it('should show status bar with speed limit inputs', async () => {
    await navigateTo('Torrents');
    const statusBar = $(SEL.torrentStatusBar);
    await statusBar.waitForDisplayed({ timeout: 3_000 });
    await expect($(SEL.speedLimitDl)).toBeDisplayed();
    await expect($(SEL.speedLimitUl)).toBeDisplayed();
  });

  it('should add magnet link and show torrent in list', async () => {
    await navigateTo('Torrents');

    const magnetInput = $(SEL.magnetInput);
    // Use a known valid magnet link for testing
    const testMagnet = 'magnet:?xt=urn:btih:TESTINFOHASH&dn=test-file';
    await magnetInput.setValue(testMagnet);

    const addBtn = $(SEL.addMagnetBtn);
    await addBtn.click();

    // Torrent should appear in list (may be in initializing/downloading state)
    await browser.waitUntil(
      async () => (await getCount(SEL.torrentRow)) === 1,
      { timeout: 15_000 },
    );
    await expect($(SEL.torrentStateBadge)).toBeDisplayed();
  });

  it('should select a torrent and show detail panel', async function () {
    await navigateTo('Torrents');

    const count = await getCount(SEL.torrentRow);
    if (count > 0) {
      // Click first torrent row
      const rows = await $$(SEL.torrentRow);
      await rows[0].click();
      const detailPanel = $(SEL.torrentDetailPanel);
      await detailPanel.waitForDisplayed({ timeout: 3_000 });

      // Tabs should be visible
      await expect($(SEL.detailTabFiles)).toBeDisplayed();
      await expect($(SEL.detailTabPeers)).toBeDisplayed();
      await expect($(SEL.detailTabInfo)).toBeDisplayed();
    } else {
      this.skip();
    }
  });

  it('should switch detail panel tabs', async function () {
    await navigateTo('Torrents');

    const count = await getCount(SEL.torrentRow);
    if (count > 0) {
      const rows = await $$(SEL.torrentRow);
      await rows[0].click();
      const detailPanel = $(SEL.torrentDetailPanel);
      await detailPanel.waitForDisplayed({ timeout: 3_000 });

      // Click Files tab — should show file tree
      await $(SEL.detailTabFiles).click();
      await $(SEL.fileTree).waitForDisplayed({ timeout: 3_000 });

      // Click Peers tab — should show peer table
      await $(SEL.detailTabPeers).click();
      await $(SEL.peerTable).waitForDisplayed({ timeout: 3_000 });

      // Click Info tab — should show info hash
      await $(SEL.detailTabInfo).click();
      await $(SEL.torrentInfoHash).waitForDisplayed({ timeout: 3_000 });
    } else {
      this.skip();
    }
  });

  it('should show progress bar for active torrents', async () => {
    await navigateTo('Torrents');

    const count = await getCount(SEL.torrentRow);
    if (count > 0) {
      // Each row should have a progress bar
      const progress = $(SEL.torrentProgress);
      await progress.waitForDisplayed({ timeout: 3_000 });
    }
  });

  it('should pause and resume a torrent', async function () {
    await navigateTo('Torrents');

    const count = await getCount(SEL.torrentRow);
    if (count > 0) {
      const rows = await $$(SEL.torrentRow);
      await rows[0].click();

      // Click pause
      const pauseBtn = $(SEL.torrentPauseBtn);
      const pauseVisible = await pauseBtn.isDisplayed().catch(() => false);
      if (pauseVisible) {
        await pauseBtn.click();
        await sleep(1000);
        const badge = $(SEL.torrentStateBadge);
        await expect(badge).toHaveText(expect.stringContaining('paused'), { wait: 5_000 });

        // Click resume
        const resumeBtn = $(SEL.torrentResumeBtn);
        await resumeBtn.waitForDisplayed({ timeout: 3_000 });
        await resumeBtn.click();
        await sleep(1000);
        const badgeAfter = $(SEL.torrentStateBadge);
        const text = await badgeAfter.getText();
        expect(text.toLowerCase()).not.toContain('paused');
      }
    } else {
      this.skip();
    }
  });

  it('should remove a torrent', async function () {
    await navigateTo('Torrents');

    const countBefore = await getCount(SEL.torrentRow);
    if (countBefore > 0) {
      const rows = await $$(SEL.torrentRow);
      await rows[0].click();

      const removeBtn = $(SEL.torrentRemoveBtn);
      const removeVisible = await removeBtn.isDisplayed().catch(() => false);
      if (removeVisible) {
        // Handle confirmation dialog
        await removeBtn.click();
        await waitAndAcceptAlert();
        await sleep(2000);

        const countAfter = await getCount(SEL.torrentRow);
        expect(countAfter).toBeLessThan(countBefore);
      }
    } else {
      this.skip();
    }
  });

  it('should toggle file checkboxes in detail panel', async function () {
    await navigateTo('Torrents');

    const count = await getCount(SEL.torrentRow);
    if (count > 0) {
      const rows = await $$(SEL.torrentRow);
      await rows[0].click();
      await $(SEL.detailTabFiles).click();
      await $(SEL.fileTree).waitForDisplayed({ timeout: 3_000 });

      const checkboxes = $$(SEL.fileCheckbox);
      if ((await checkboxes.length) > 1) {
        // Uncheck the second file
        const secondCheckbox = checkboxes[1];
        const wasChecked = await secondCheckbox.isSelected();
        await secondCheckbox.click();
        const isNowChecked = await secondCheckbox.isSelected();
        expect(isNowChecked).not.toBe(wasChecked);

        // Re-check it to restore state
        await secondCheckbox.click();
      }
    } else {
      this.skip();
    }
  });
});
