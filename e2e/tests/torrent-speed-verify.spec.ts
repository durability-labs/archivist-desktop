import { navigateTo, sleep, SEL, waitAndAcceptAlert } from '../helpers';
import * as fs from 'fs';

/**
 * @online @slow
 * Torrent overwrite + speed verification test.
 *
 * Adds the Ubuntu .torrent file via Tauri invoke (bypassing native file dialog),
 * then polls UI for state transitions, non-zero DL speeds, and increasing progress.
 */

const TORRENT_FILE_PATH = 'C:\\Users\\anon\\Downloads\\ubuntu-24.04.4-desktop-amd64.iso.torrent';

describe('Torrent speed verification @online @slow', () => {
  it('should add .torrent file, show download progress and non-zero speed', async function () {
    this.timeout(180000);

    // Navigate to Torrents page
    await navigateTo('Torrents');
    await browser.pause(1000);

    // Read and base64-encode the .torrent file
    const torrentBytes = fs.readFileSync(TORRENT_FILE_PATH);
    const torrentBase64 = torrentBytes.toString('base64');

    // Remove any existing torrents first
    let existingRows = await $$(SEL.torrentRow);
    const existingRowCount = await existingRows.length;
    if (existingRowCount > 0) {
      console.log(`[cleanup] Removing ${existingRowCount} existing torrent(s)...`);
      for (let i = 0; i < existingRowCount; i++) {
        const row = await $(SEL.torrentRow);
        if (await row.isDisplayed().catch(() => false)) {
          await row.click();
          await browser.pause(300);
          const removeBtn = await $(SEL.torrentRemoveBtn);
          if (await removeBtn.isDisplayed().catch(() => false)) {
            await removeBtn.click();
            await waitAndAcceptAlert(5000);
            await browser.pause(1000);
          }
        }
      }
    }

    // Add torrent via Tauri invoke (bypasses native file dialog)
    console.log('[add] Adding .torrent file via Tauri invoke...');
    const addResult = await browser.execute(async (b64: string) => {
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
    expect((addResult as any).ok).toBeTruthy();

    // Wait for torrent row to appear
    const torrentRow = await $(SEL.torrentRow);
    await torrentRow.waitForDisplayed({ timeout: 15000 });

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
      await sleep(2000);

      const badgeEl = await torrentRow.$(SEL.torrentStateBadge);
      const state = ((await badgeEl.getText().catch(() => '')) ?? '').trim().toLowerCase();
      const dlSpeedEl = await torrentRow.$(SEL.torrentSpeedDl);
      const dlSpeed = ((await dlSpeedEl.getText().catch(() => '')) ?? '').trim();
      const ulSpeedEl = await torrentRow.$(SEL.torrentSpeedUl);
      const ulSpeed = ((await ulSpeedEl.getText().catch(() => '')) ?? '').trim();

      // Get progress bar width
      const progressFill = await torrentRow.$(SEL.torrentProgressFill);
      let progressWidth = '0%';
      if (await progressFill.isDisplayed().catch(() => false)) {
        progressWidth = await browser.execute(
          (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement;
            return el ? el.style.width : '0%';
          },
          SEL.torrentProgressFill
        ) ?? '0%';
      }

      // Get progress text
      let progressText = '';
      const progressTextEl = await torrentRow.$('.torrent-progress-text');
      if (await progressTextEl.isDisplayed().catch(() => false)) {
        progressText = ((await progressTextEl.getText().catch(() => '')) ?? '').trim();
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

    // Cleanup: remove the torrent
    console.log('[cleanup] Removing test torrent...');
    try {
      const row = await $(SEL.torrentRow);
      if (await row.isDisplayed().catch(() => false)) {
        await row.click();
        await browser.pause(300);
        const removeBtn = await $(SEL.torrentRemoveBtn);
        if (await removeBtn.isDisplayed().catch(() => false)) {
          await removeBtn.click();
          await waitAndAcceptAlert(5000);
          await browser.pause(2000);
        }
      }
    } catch (cleanupErr) {
      console.log('[cleanup] Error during cleanup:', cleanupErr);
    }
  });
});
