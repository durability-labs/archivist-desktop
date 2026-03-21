import { ensurePastOnboarding, navigateTo, hasText, isDisplayed, SEL } from '../helpers';

/**
 * Torrents page UI smoke tests — lightweight UI structure checks.
 *
 * Verifies all UI structure renders without crashes.
 */

describe('Torrents page UI', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('should navigate to Torrents page via sidebar', async () => {
    await navigateTo('Torrents');

    // Page should render (may show loading or full state)
    const torrentsPage = $(SEL.torrentsPage);
    await torrentsPage.waitForDisplayed({ timeout: 5_000 });
  });

  it('/torrents renders with correct header', async () => {
    await browser.url('/torrents');
    await browser.pause(1_000);

    const header = $(SEL.torrentsHeader);
    await expect(header).toHaveText('Torrents');
  });

  it('/torrents shows global speed stats', async () => {
    await browser.url('/torrents');
    await $(SEL.torrentsHeader).waitForDisplayed({ timeout: 10_000 });

    // Wait for loading state to pass
    await browser.pause(2000);

    // Global stats should be visible with DL/UL speed indicators
    const dlSpeed = $(SEL.globalDlSpeed);
    const ulSpeed = $(SEL.globalUlSpeed);
    await dlSpeed.waitForDisplayed({ timeout: 5_000 });
    await ulSpeed.waitForDisplayed({ timeout: 5_000 });
  });

  it('/torrents shows add-torrent bar with magnet input', async () => {
    await browser.url('/torrents');
    await $(SEL.torrentsHeader).waitForDisplayed({ timeout: 10_000 });

    // Wait for loading to finish
    await browser.pause(2000);

    // Add torrent bar with magnet input and file button
    const magnetInput = $(SEL.magnetInput);
    await magnetInput.waitForDisplayed({ timeout: 5_000 });
    await expect(magnetInput).toHaveAttr('placeholder', expect.stringContaining('magnet'));

    const addFileBtn = $(SEL.addFileBtn);
    await expect(addFileBtn).toBeDisplayed();
  });

  it('/torrents shows empty state (no Tauri IPC = no torrents)', async () => {
    await browser.url('/torrents');
    await $(SEL.torrentsHeader).waitForDisplayed({ timeout: 10_000 });

    // Wait for loading to finish
    await browser.pause(2000);

    // Empty state should be visible since we have no session stats
    const emptyState = $(SEL.torrentEmptyState);
    await emptyState.waitForDisplayed({ timeout: 5_000 });
  });

  it('/torrents shows status bar with speed limit inputs', async () => {
    await browser.url('/torrents');
    await $(SEL.torrentsHeader).waitForDisplayed({ timeout: 10_000 });

    // Wait for loading to finish
    await browser.pause(2000);

    // Status bar with speed limit inputs
    const statusBar = $(SEL.torrentStatusBar);
    await statusBar.waitForDisplayed({ timeout: 5_000 });

    const dlLimit = $(SEL.speedLimitDl);
    await expect(dlLimit).toBeDisplayed();

    const ulLimit = $(SEL.speedLimitUl);
    await expect(ulLimit).toBeDisplayed();
  });

  it('/torrents — no JS errors crash the page', async () => {
    await browser.url('/torrents');
    await $(SEL.torrentsHeader).waitForDisplayed({ timeout: 10_000 });
    await browser.pause(3000);

    // The torrents-page div should still be in the DOM (no React error boundary crash)
    await expect($(SEL.torrentsPage)).toBeDisplayed();
  });
});
