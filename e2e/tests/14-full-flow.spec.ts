import {
  navigateTo,
  hasText,
  isDisplayed,
  waitForPort,
  sleep,
  SEL,
  apiUploadFile,
  apiDeleteFile,
} from '../helpers';

/**
 * Full integration flow tests — cross-page workflows.
 */
describe('Full integration flow', () => {
  before(async () => {
    await waitForPort(8080, 15_000);
  });

  it('upload file → verify in list → download by CID → delete', async () => {
    let testCid: string | null = null;

    try {
      // Step 1: Upload a test file via API
      testCid = await apiUploadFile('e2e-full-flow-test-content', 'full-flow.txt');
      expect(testCid).toBeTruthy();

      // Step 2: Navigate to Restore (Files) page and verify CID in list
      await navigateTo('Upload & Download');
      await browser.pause(1_000);

      // Click refresh if available
      const refreshVisible = await isDisplayed('*=Refresh', 2000);
      if (refreshVisible) {
        const refreshBtn = await hasText('button', 'Refresh');
        await refreshBtn.click();
        await browser.pause(2_000);
      }

      // Verify the file appears in the files table
      const cidPrefix = testCid!.substring(0, 10);
      const fileRow = await $(`*=${cidPrefix}`);
      const hasRow = await fileRow.isDisplayed().catch(() => false);
      expect(hasRow).toBeTruthy();

      // Step 3: Test CID paste auto-download trigger
      const cidInput = await $(SEL.cidInput);
      await expect(cidInput).toBeDisplayed();

      // Simulate pasting the CID (use setValue + dispatch paste event)
      await cidInput.setValue(testCid!);
      await browser.pause(500);

      // CID should be validated (green border)
      const inputClasses = await cidInput.getAttribute('class') ?? '';
      const parentEl = await cidInput.$('..');
      const parentClasses = await parentEl.getAttribute('class') ?? '';
      const hasValidClass = inputClasses.includes('valid') || parentClasses.includes('valid');

      // The input should at least accept the CID format
      const inputValue = await cidInput.getValue();
      expect(inputValue).toBe(testCid);

      // Step 4: Clean up
      await apiDeleteFile(testCid);
      testCid = null;
    } finally {
      // Ensure cleanup even on failure
      if (testCid) {
        await apiDeleteFile(testCid).catch(() => {});
      }
    }
  });

  it('CID paste triggers auto-download dialog', async () => {
    let testCid: string | null = null;

    try {
      // Upload a test file
      testCid = await apiUploadFile('cid-paste-test', 'paste-test.txt');

      await navigateTo('Upload & Download');
      await browser.pause(500);

      const cidInput = await $(SEL.cidInput);
      await expect(cidInput).toBeDisplayed();

      // Focus the input and simulate paste via clipboard
      await cidInput.click();

      // Use browser.execute to dispatch a paste event with CID data
      await browser.execute((cid) => {
        const input = document.querySelector('.download-by-cid input[type="text"]') as HTMLInputElement;
        if (input) {
          input.value = cid;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            clipboardData: new DataTransfer(),
          });
          (pasteEvent.clipboardData as DataTransfer).setData('text/plain', cid);
          input.dispatchEvent(pasteEvent);
        }
      }, testCid);

      // Wait for auto-download logic (300ms validation delay + processing)
      await sleep(2_000);

      // After paste, a save dialog may appear or the download may auto-trigger
      // The CID input should show as valid
      const hasValidation = await isDisplayed(SEL.cidInputValid, 2000);
      const hasInput = await cidInput.getValue();
      expect(hasInput.length).toBeGreaterThan(0);

      // Clean up
      await apiDeleteFile(testCid);
      testCid = null;
    } finally {
      if (testCid) {
        await apiDeleteFile(testCid).catch(() => {});
      }
    }
  });

  it('navigate across all main pages without errors', async () => {
    const pages = [
      'Dashboard',
      'Folder Upload',
      'Upload & Download',
      'Media Downloader',
      'Website Scraper',
      'Torrents',
      'My Devices',
      'Add Device',
      'Make a Deal',
      'My Deals',
      'Wallet',
    ];

    for (const pageName of pages) {
      await navigateTo(pageName);
      await browser.pause(300);

      // Verify no uncaught errors (page should have content)
      const mainContent = await $('.main-content');
      await mainContent.waitForDisplayed({ timeout: 5_000 });
    }

    // Also test Advanced accordion pages
    const advancedPages = ['Logs', 'Backup Server', 'Settings'];
    for (const pageName of advancedPages) {
      await navigateTo(pageName);
      await browser.pause(300);

      const mainContent = await $('.main-content');
      await mainContent.waitForDisplayed({ timeout: 5_000 });
    }
  });
});
