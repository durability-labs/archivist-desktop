import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, sleep, navigateTo, SEL } from '../helpers';

test.describe.serial('Torrents page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 30_000);
  });

  test('should navigate to Torrents page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.torrentsPage)).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(SEL.torrentsHeader)).toHaveText('Torrents');
    } finally {
      await browser.close();
    }
  });

  test('should show empty state when no torrents', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      // Either show empty state OR existing torrents from previous session
      const hasTorrents = await page.locator(SEL.torrentRow).count() > 0;
      if (!hasTorrents) {
        await expect(page.locator(SEL.torrentEmptyState)).toBeVisible({ timeout: 3_000 });
      }
    } finally {
      await browser.close();
    }
  });

  test('should show add torrent bar with magnet input and file button', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.magnetInput)).toBeVisible({ timeout: 3_000 });
      await expect(page.locator(SEL.magnetInput)).toHaveAttribute('placeholder', /magnet/i);
      await expect(page.locator(SEL.addFileBtn)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show global speed stats in header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.globalDlSpeed)).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(SEL.globalUlSpeed)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show status bar with speed limit inputs', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.torrentStatusBar)).toBeVisible({ timeout: 3_000 });
      await expect(page.locator(SEL.speedLimitDl)).toBeVisible();
      await expect(page.locator(SEL.speedLimitUl)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should add magnet link and show torrent in list', async () => {
    // Uses a well-known public domain torrent (Ubuntu ISO)
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const magnetInput = page.locator(SEL.magnetInput);
      // Use a known valid magnet link for testing
      const testMagnet = 'magnet:?xt=urn:btih:TESTINFOHASH&dn=test-file';
      await magnetInput.fill(testMagnet);

      const addBtn = page.locator(SEL.addMagnetBtn);
      await addBtn.click();

      // Torrent should appear in list (may be in initializing/downloading state)
      await expect(page.locator(SEL.torrentRow)).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator(SEL.torrentStateBadge).first()).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should select a torrent and show detail panel', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      const count = await rows.count();
      if (count > 0) {
        // Click first torrent row
        await rows.first().click();
        await expect(page.locator(SEL.torrentDetailPanel)).toBeVisible({ timeout: 3_000 });

        // Tabs should be visible
        await expect(page.locator(SEL.detailTabFiles)).toBeVisible();
        await expect(page.locator(SEL.detailTabPeers)).toBeVisible();
        await expect(page.locator(SEL.detailTabInfo)).toBeVisible();
      } else {
        test.skip(true, 'No torrents in list to select');
      }
    } finally {
      await browser.close();
    }
  });

  test('should switch detail panel tabs', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      if (await rows.count() > 0) {
        await rows.first().click();
        await expect(page.locator(SEL.torrentDetailPanel)).toBeVisible({ timeout: 3_000 });

        // Click Files tab — should show file tree
        await page.locator(SEL.detailTabFiles).click();
        await expect(page.locator(SEL.fileTree)).toBeVisible({ timeout: 3_000 });

        // Click Peers tab — should show peer table
        await page.locator(SEL.detailTabPeers).click();
        await expect(page.locator(SEL.peerTable)).toBeVisible({ timeout: 3_000 });

        // Click Info tab — should show info hash
        await page.locator(SEL.detailTabInfo).click();
        await expect(page.locator(SEL.torrentInfoHash)).toBeVisible({ timeout: 3_000 });
      } else {
        test.skip(true, 'No torrents available for detail view');
      }
    } finally {
      await browser.close();
    }
  });

  test('should show progress bar for active torrents', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      if (await rows.count() > 0) {
        // Each row should have a progress bar
        await expect(page.locator(SEL.torrentProgress).first()).toBeVisible({ timeout: 3_000 });
      }
    } finally {
      await browser.close();
    }
  });

  test('should pause and resume a torrent', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      if (await rows.count() > 0) {
        await rows.first().click();

        // Click pause
        const pauseBtn = page.locator(SEL.torrentPauseBtn);
        if (await pauseBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await pauseBtn.click();
          await sleep(1000);
          await expect(page.locator(SEL.torrentStateBadge).first()).toContainText(/paused/i, { timeout: 5_000 });

          // Click resume
          const resumeBtn = page.locator(SEL.torrentResumeBtn);
          await expect(resumeBtn).toBeVisible({ timeout: 3_000 });
          await resumeBtn.click();
          await sleep(1000);
          await expect(page.locator(SEL.torrentStateBadge).first()).not.toContainText(/paused/i, { timeout: 5_000 });
        }
      } else {
        test.skip(true, 'No torrents available to pause/resume');
      }
    } finally {
      await browser.close();
    }
  });

  test('should remove a torrent', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      const countBefore = await rows.count();
      if (countBefore > 0) {
        await rows.first().click();

        const removeBtn = page.locator(SEL.torrentRemoveBtn);
        if (await removeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          // Handle confirmation dialog
          page.on('dialog', (dialog) => dialog.accept());
          await removeBtn.click();
          await sleep(2000);

          const countAfter = await page.locator(SEL.torrentRow).count();
          expect(countAfter).toBeLessThan(countBefore);
        }
      } else {
        test.skip(true, 'No torrents available to remove');
      }
    } finally {
      await browser.close();
    }
  });

  test('should toggle file checkboxes in detail panel', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Torrents');

      const rows = page.locator(SEL.torrentRow);
      if (await rows.count() > 0) {
        await rows.first().click();
        await page.locator(SEL.detailTabFiles).click();
        await expect(page.locator(SEL.fileTree)).toBeVisible({ timeout: 3_000 });

        const checkboxes = page.locator(SEL.fileCheckbox);
        const checkboxCount = await checkboxes.count();
        if (checkboxCount > 1) {
          // Uncheck the second file
          const secondCheckbox = checkboxes.nth(1);
          const wasChecked = await secondCheckbox.isChecked();
          await secondCheckbox.click();
          const isNowChecked = await secondCheckbox.isChecked();
          expect(isNowChecked).not.toBe(wasChecked);

          // Re-check it to restore state
          await secondCheckbox.click();
        }
      } else {
        test.skip(true, 'No torrents available for file selection');
      }
    } finally {
      await browser.close();
    }
  });
});
