import {
  navigateTo,
  hasText,
  isDisplayed,
  waitForPort,
  sleep,
  SEL,
  apiUploadFile,
  apiDeleteFile,
  apiListFiles,
  waitAndAcceptAlert,
} from '../helpers';

/**
 * Phase 3b — File Operations: upload, delete single, delete all, clear storage
 *
 * Assumes the sidecar API is reachable on port 8080.
 */

describe('File Operations', () => {
  const uploadedCids: string[] = [];

  before(async () => {
    await waitForPort(8080, 15_000);

    // Clean up any leftover test files
    try {
      const list = await apiListFiles();
      for (const item of list.content) {
        await apiDeleteFile(item.cid);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  after(async () => {
    // Clean up any test files we uploaded
    for (const cid of uploadedCids) {
      try {
        await apiDeleteFile(cid);
      } catch {
        /* ignore cleanup errors */
      }
    }
  });

  it('should show uploaded file appears in file list', async () => {
    // Upload a small file via the sidecar API
    const testContent = `e2e upload test ${Date.now()}`;
    const cid = await apiUploadFile(testContent, 'e2e-upload-test.txt');
    uploadedCids.push(cid);

    expect(cid).toBeTruthy();
    expect(cid.length).toBeGreaterThan(10);

    await navigateTo('Upload & Download');

    // Refresh the file list
    const refreshBtn = await hasText('button', 'Refresh');
    await refreshBtn.click();
    await browser.pause(2000);
    const refreshBtn2 = await hasText('button', 'Refresh');
    await refreshBtn2.click();
    await browser.pause(1000);

    // Verify the CID appears in the table
    const cidPrefix = cid.substring(0, 12);
    const cidEl = await $(`*=${cidPrefix}`);
    await cidEl.waitForDisplayed({ timeout: 10_000 });

    // Verify file-stats shows at least 1 file
    const fileStats = await $('.file-stats');
    await expect(fileStats).toHaveText(expect.stringContaining('file'));
  });

  it('should delete single file via UI Remove button', async () => {
    // Upload a file to delete
    const testContent = `e2e delete single test ${Date.now()}`;
    const cid = await apiUploadFile(testContent, 'e2e-delete-single.txt');
    // Don't track in uploadedCids since we're deleting it here

    await navigateTo('Upload & Download');

    // Refresh to see the file
    const refreshBtn = await hasText('button', 'Refresh');
    await refreshBtn.click();
    await browser.pause(2000);
    const refreshBtn2 = await hasText('button', 'Refresh');
    await refreshBtn2.click();
    await browser.pause(1000);

    // Find the file row containing our CID
    const cidPrefix = cid.substring(0, 12);
    const cidEl = await $(`*=${cidPrefix}`);
    await cidEl.waitForDisplayed({ timeout: 10_000 });

    // Click the Remove button in the row that contains our CID
    const row = await $(`//tr[contains(., '${cidPrefix}')]`);
    const removeBtn = await row.$('*=Remove');
    await removeBtn.click();

    // Accept the confirmation dialog
    await waitAndAcceptAlert();

    // Wait for deletion to process
    await browser.pause(2000);

    // Refresh and verify file is gone
    const refreshBtn3 = await hasText('button', 'Refresh');
    await refreshBtn3.click();
    await browser.pause(2000);

    // The CID should no longer be visible
    const stillVisible = await isDisplayed(`*=${cidPrefix}`, 2000);
    expect(stillVisible).toBeFalsy();
  });

  it('should delete all files via Delete All button', async () => {
    // Upload 3 test files
    const cids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const cid = await apiUploadFile(
        `e2e delete-all test file ${i} ${Date.now()}`,
        `e2e-delete-all-${i}.txt`
      );
      cids.push(cid);
    }

    await navigateTo('Upload & Download');

    // Refresh to see the files
    const refreshBtn = await hasText('button', 'Refresh');
    await refreshBtn.click();
    await browser.pause(2000);
    const refreshBtn2 = await hasText('button', 'Refresh');
    await refreshBtn2.click();
    await browser.pause(1000);

    // Verify files appear
    const fileStats = await $('.file-stats');
    await expect(fileStats).toBeDisplayed();

    // Verify Delete All button is visible
    const deleteAllBtn = await hasText('.file-stats button', 'Delete All');
    await deleteAllBtn.waitForDisplayed({ timeout: 5_000 });

    // Click Delete All
    await deleteAllBtn.click();

    // Accept the confirmation dialog
    await waitAndAcceptAlert();

    // Wait for deletion
    await browser.pause(3000);

    // Refresh and check the list is empty
    const refreshBtn3 = await hasText('button', 'Refresh');
    await refreshBtn3.click();
    await browser.pause(2000);

    // File stats should show 0 files
    await expect(fileStats).toHaveText(expect.stringContaining('0 files'));

    // Table should show empty state
    const emptyState = await $(SEL.emptyState);
    await emptyState.waitForDisplayed({ timeout: 5_000 });
  });

  it('should clear storage from Settings page', async () => {
    // Upload 2 test files
    for (let i = 0; i < 2; i++) {
      await apiUploadFile(
        `e2e settings clear test ${i} ${Date.now()}`,
        `e2e-settings-clear-${i}.txt`
      );
    }

    // Navigate to Settings
    await navigateTo('Settings');

    // Find the Clear Storage button
    const clearBtn = await hasText('button', 'Clear Storage');
    await clearBtn.waitForDisplayed({ timeout: 10_000 });

    // Click Clear Storage
    await clearBtn.click();

    // Accept the confirmation dialog
    await waitAndAcceptAlert();

    // Wait for operation
    await browser.pause(3000);

    // Navigate to Restore to verify files are gone
    await navigateTo('Upload & Download');
    const refreshBtn = await hasText('button', 'Refresh');
    await refreshBtn.click();
    await browser.pause(2000);

    // Should show empty state
    const emptyState = await $(SEL.emptyState);
    await emptyState.waitForDisplayed({ timeout: 5_000 });
  });

  it('should show upload progress bar elements', async () => {
    await navigateTo('Upload & Download');

    // Verify the upload button is visible
    const uploadBtn = await $(SEL.uploadBtn);
    await expect(uploadBtn).toBeDisplayed();

    // The upload progress bar should not be visible initially
    const progressVisible = await isDisplayed('//*[contains(@class, "info-banner")][contains(., "Uploading")]', 1000);
    expect(progressVisible).toBeFalsy();
  });

  it('should update storage stats after upload and delete', async () => {
    await navigateTo('Upload & Download');

    // Refresh to get current state
    const refreshBtn = await hasText('button', 'Refresh');
    await refreshBtn.click();
    await browser.pause(1000);

    const fileStats = await $('.file-stats');
    const initialText = await fileStats.getText();

    // Upload a file via API
    const cid = await apiUploadFile(
      'e2e storage stats test ' + Date.now(),
      'e2e-stats-test.txt'
    );

    // Refresh and check stats updated
    const refreshBtn2 = await hasText('button', 'Refresh');
    await refreshBtn2.click();
    await browser.pause(2000);
    const refreshBtn3 = await hasText('button', 'Refresh');
    await refreshBtn3.click();
    await browser.pause(1000);

    const afterUploadText = await fileStats.getText();
    // Stats should have changed (more files or more bytes)
    expect(afterUploadText).not.toBe(initialText);

    // Clean up
    await apiDeleteFile(cid);
  });
});
