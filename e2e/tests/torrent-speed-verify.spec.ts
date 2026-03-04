import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, sleep, SEL } from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @online @slow
 * Torrent overwrite + speed verification test.
 *
 * Adds the Ubuntu .torrent file via Tauri invoke (bypassing native file dialog),
 * then polls UI for state transitions, non-zero DL speeds, and increasing progress.
 */

const TORRENT_FILE_PATH = 'C:\\Users\\anon\\Downloads\\ubuntu-24.04.4-desktop-amd64.iso.torrent';

test.describe('Torrent speed verification @online @slow', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should add .torrent file, show download progress and non-zero speed', async () => {
    test.setTimeout(180_000);
    const { browser, page } = await connectToApp();

    try {
      // Navigate to Torrents page
      await navigateTo(page, 'Torrents');
      await page.waitForTimeout(1_000);

      // Read and base64-encode the .torrent file
      const torrentBytes = fs.readFileSync(TORRENT_FILE_PATH);
      const torrentBase64 = torrentBytes.toString('base64');

      // Remove any existing torrents first
      let existingRows = await page.locator(SEL.torrentRow).count();
      if (existingRows > 0) {
        console.log(`[cleanup] Removing ${existingRows} existing torrent(s)...`);
        for (let i = 0; i < existingRows; i++) {
          const row = page.locator(SEL.torrentRow).first();
          if (await row.isVisible().catch(() => false)) {
            await row.click();
            await page.waitForTimeout(300);
            const removeBtn = page.locator(SEL.torrentRemoveBtn);
            if (await removeBtn.isVisible().catch(() => false)) {
              page.once('dialog', d => d.accept());
              await removeBtn.click();
              await page.waitForTimeout(1_000);
            }
          }
        }
      }

      // Add torrent via Tauri invoke (bypasses native file dialog)
      console.log('[add] Adding .torrent file via Tauri invoke...');
      const addResult = await page.evaluate(async (b64: string) => {
        try {
          const result = await (window as any).__TAURI_INTERNALS__.invoke('add_torrent', {
            params: {
              source: b64,
              sourceType: 'file',
              paused: false,
              sequential: false,
            },
          });
          return { ok: true, data: result };
        } catch (e: any) {
          return { ok: false, error: String(e) };
        }
      }, torrentBase64);

      console.log('[add] Result:', JSON.stringify(addResult, null, 2));
      expect(addResult.ok).toBeTruthy();

      // Wait for torrent row to appear
      const torrentRow = page.locator(SEL.torrentRow).first();
      await expect(torrentRow).toBeVisible({ timeout: 15_000 });

      // Poll for state transitions, speed, and progress
      const samples: Array<{
        time: string;
        state: string;
        dlSpeed: string;
        ulSpeed: string;
        progressWidth: string;
        progressText: string;
      }> = [];

      let sawDownloading = false;
      let sawNonZeroDlSpeed = false;
      let firstProgress = -1;
      let lastProgress = -1;
      let progressIncreased = false;

      const maxPolls = 60; // 60 * 2s = 120s
      for (let i = 0; i < maxPolls; i++) {
        await sleep(2_000);

        const state = (await torrentRow.locator(SEL.torrentStateBadge).textContent() ?? '').trim().toLowerCase();
        const dlSpeed = (await torrentRow.locator(SEL.torrentSpeedDl).textContent() ?? '').trim();
        const ulSpeed = (await torrentRow.locator(SEL.torrentSpeedUl).textContent() ?? '').trim();

        // Get progress bar width
        const progressFill = torrentRow.locator(SEL.torrentProgressFill);
        let progressWidth = '0%';
        if (await progressFill.isVisible().catch(() => false)) {
          progressWidth = await progressFill.evaluate(el => (el as HTMLElement).style.width) ?? '0%';
        }

        // Get progress text
        let progressText = '';
        const progressTextEl = torrentRow.locator('.torrent-progress-text');
        if (await progressTextEl.isVisible().catch(() => false)) {
          progressText = (await progressTextEl.textContent() ?? '').trim();
        }

        const sample = {
          time: new Date().toISOString(),
          state,
          dlSpeed,
          ulSpeed,
          progressWidth,
          progressText,
        };
        samples.push(sample);
        console.log(`[poll ${i}] state=${state} dl=${dlSpeed} ul=${ulSpeed} progress=${progressWidth} (${progressText})`);

        // Track state transitions
        if (state.includes('download')) sawDownloading = true;
        if (state.includes('seeding')) {
          sawDownloading = true; // must have downloaded
          sawNonZeroDlSpeed = true; // must have had speed
          progressIncreased = true;
        }

        // Track non-zero DL speed
        if (dlSpeed && dlSpeed !== '0 B/s') {
          sawNonZeroDlSpeed = true;
        }

        // Track progress
        const progressNum = parseFloat(progressWidth);
        if (!isNaN(progressNum)) {
          if (firstProgress < 0) firstProgress = progressNum;
          if (progressNum > lastProgress) {
            lastProgress = progressNum;
          }
          if (lastProgress > firstProgress) {
            progressIncreased = true;
          }
        }

        // Early exit if we've seen everything
        if (sawDownloading && sawNonZeroDlSpeed && progressIncreased) {
          console.log('[done] All assertions met, stopping poll early.');
          break;
        }

        // Early exit if seeding (download complete)
        if (state.includes('seeding')) {
          console.log('[done] Torrent is seeding (download complete).');
          break;
        }

        // Early exit on error
        if (state.includes('error')) {
          console.error('[error] Torrent entered error state!');
          break;
        }
      }

      console.log('\n=== SUMMARY ===');
      console.log(`Saw downloading state: ${sawDownloading}`);
      console.log(`Saw non-zero DL speed: ${sawNonZeroDlSpeed}`);
      console.log(`Progress increased: ${progressIncreased} (${firstProgress}% -> ${lastProgress}%)`);
      console.log(`Total samples: ${samples.length}`);

      // Assertions
      expect(sawDownloading).toBeTruthy();
      expect(sawNonZeroDlSpeed).toBeTruthy();
      expect(progressIncreased).toBeTruthy();

    } finally {
      // Cleanup: remove the torrent
      console.log('[cleanup] Removing test torrent...');
      try {
        const row = page.locator(SEL.torrentRow).first();
        if (await row.isVisible().catch(() => false)) {
          await row.click();
          await page.waitForTimeout(300);
          const removeBtn = page.locator(SEL.torrentRemoveBtn);
          if (await removeBtn.isVisible().catch(() => false)) {
            page.once('dialog', d => d.accept());
            await removeBtn.click();
            await page.waitForTimeout(2_000);
          }
        }
      } catch (cleanupErr) {
        console.log('[cleanup] Error during cleanup:', cleanupErr);
      }

      await browser.close();
    }
  });
});
