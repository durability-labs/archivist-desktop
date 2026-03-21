import { navigateTo, hasText, SEL } from '../helpers';

/**
 * Media Player page — playback controls and UI interaction tests.
 * These tests require a completed download in the media library.
 */
describe('Media Player page', () => {
  /**
   * Helper: navigate to Media Download page and try to open the player
   * for the first completed video download.
   * Returns true if player was opened, false if no playable media.
   */
  async function tryOpenPlayer(): Promise<boolean> {
    await navigateTo('Media Download');
    await browser.pause(1000);

    const playBtn = await $('.play-btn');
    let hasPlay = await playBtn.isDisplayed().catch(() => false);
    if (!hasPlay) {
      const playTextBtn = await hasText('button', 'Play');
      hasPlay = await playTextBtn.isDisplayed().catch(() => false);
      if (hasPlay) {
        await playTextBtn.click();
        await browser.pause(2000);
        const playerPage = await $(SEL.mediaPlayerPage);
        return await playerPage.isDisplayed().catch(() => false);
      }
      return false;
    }

    await playBtn.click();
    await browser.pause(2000);

    const playerPage = await $(SEL.mediaPlayerPage);
    return await playerPage.isDisplayed().catch(() => false);
  }

  it('should navigate to player from completed download', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const video = await $(SEL.mediaPlayerVideo);
    await video.waitForDisplayed({ timeout: 10000 });
  });

  it('should show player controls', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const controls = await $(SEL.playerControls);
    await expect(controls).toBeDisplayed();
    const playBtn = await $(SEL.playBtn);
    await expect(playBtn).toBeDisplayed();
    const muteBtn = await $(SEL.muteBtn);
    await expect(muteBtn).toBeDisplayed();
    const seekBar = await $(SEL.seekBar);
    await expect(seekBar).toBeDisplayed();
    const volumeBar = await $(SEL.volumeBar);
    await expect(volumeBar).toBeDisplayed();
  });

  it('should toggle play/pause on button click', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const playButton = await $(SEL.playBtn);
    const initialText = await playButton.getText();

    // Click to toggle
    await playButton.click();
    await browser.pause(500);

    const afterText = await playButton.getText();
    expect(afterText).not.toEqual(initialText);

    // Toggle back
    await playButton.click();
    await browser.pause(500);

    const restoredText = await playButton.getText();
    expect(restoredText).toEqual(initialText);
  });

  it('should toggle mute/unmute on button click', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const muteButton = await $(SEL.muteBtn);
    const initialText = await muteButton.getText();

    await muteButton.click();
    await browser.pause(300);

    const afterText = await muteButton.getText();
    expect(afterText).not.toEqual(initialText);

    // Toggle back
    await muteButton.click();
    await browser.pause(300);

    const restoredText = await muteButton.getText();
    expect(restoredText).toEqual(initialText);
  });

  it('should toggle playlist sidebar', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const toggleBtn = await $(SEL.playlistToggleBtn);
    const hasToggle = await toggleBtn.isDisplayed().catch(() => false);
    if (!hasToggle) {
      this.skip();
      return;
    }

    const sidebar = await $(SEL.playlistSidebar);
    const sidebarBefore = await sidebar.isDisplayed().catch(() => false);

    await toggleBtn.click();
    await browser.pause(500);

    const sidebarAfter = await sidebar.isDisplayed().catch(() => false);
    expect(sidebarAfter).not.toEqual(sidebarBefore);

    // Toggle back
    await toggleBtn.click();
    await browser.pause(500);

    const sidebarRestored = await sidebar.isDisplayed().catch(() => false);
    expect(sidebarRestored).toEqual(sidebarBefore);
  });

  it('should navigate back via back button', async function () {
    this.timeout(30000);
    const opened = await tryOpenPlayer();
    if (!opened) {
      this.skip();
      return;
    }

    const backBtn = await $(SEL.playerBackBtn);
    await expect(backBtn).toBeDisplayed();
    await backBtn.click();
    await browser.pause(1000);

    const mediaPage = await $(SEL.mediaDownloadPage);
    await mediaPage.waitForDisplayed({ timeout: 5000 });
  });
});
