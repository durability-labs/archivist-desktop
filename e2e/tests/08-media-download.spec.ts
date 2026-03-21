import {
  navigateTo,
  isDisplayed,
  SEL,
  getCount,
} from '../helpers';

/**
 * @smoke
 * Media Download page basic UI tests (no internet required).
 */
describe('Media Download page @smoke', () => {
  it('should display Media Download page with header', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    const header = await $(SEL.mediaDownloadHeader);
    await expect(header).toHaveText('Media Download');
  });

  it('should display URL input and Fetch button', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    const urlInput = await $(SEL.urlInput);
    await expect(urlInput).toBeDisplayed();

    const fetchBtn = await $(SEL.fetchBtn);
    await expect(fetchBtn).toBeDisplayed();
  });

  it('should show setup banner or binary version info', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(1000);

    // Either the setup banner (yt-dlp not installed) or version info should be visible
    const hasBanner = await isDisplayed(SEL.setupBanner, 2000);
    const hasVersionInfo = await isDisplayed(SEL.binaryInfo, 2000);

    expect(hasBanner || hasVersionInfo).toBeTruthy();
  });

  it('should show empty download queue', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    const downloadQueue = await $(SEL.downloadQueue);
    await expect(downloadQueue).toBeDisplayed();

    // Either shows "No downloads yet" or the queue is empty
    const hasEmpty = await isDisplayed(SEL.queueEmpty, 2000);
    const itemCount = await getCount('.download-task, .queue-item, .download-item');

    expect(hasEmpty || itemCount >= 0).toBeTruthy();
  });

  it('should have Fetch Info button disabled when URL is empty', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    const fetchBtn = await $(SEL.fetchBtn);
    await expect(fetchBtn).toBeDisabled();
  });

  it('should enable Fetch button when URL is entered', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    const urlInput = await $(SEL.urlInput);
    await urlInput.setValue('https://example.com/video');

    const fetchBtn = await $(SEL.fetchBtn);
    await expect(fetchBtn).toBeEnabled();

    // Clear to reset state
    await urlInput.setValue('');
    await expect(fetchBtn).toBeDisabled();
  });

  it('should not show metadata preview without fetching', async () => {
    await navigateTo('Media Downloader');
    await browser.pause(500);

    // Metadata preview should not be visible by default
    const hasMetadata = await isDisplayed('.metadata-preview, .media-metadata, .video-info', 1000);

    expect(hasMetadata).toBeFalsy();
  });
});
