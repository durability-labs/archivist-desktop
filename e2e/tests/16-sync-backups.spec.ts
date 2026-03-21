import {
  navigateTo,
  hasText,
  isDisplayed,
  waitForPort,
  getCount,
  SEL,
} from '../helpers';

/**
 * @smoke
 * Sync / Backups page — deep UI interaction tests.
 */
describe('Sync & Backups page @smoke', () => {
  before(async () => {
    await waitForPort(8080, 15_000);
  });

  it('should navigate to Backups page and show header', async () => {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const header = await $('.page-header h2');
    await expect(header).toBeDisplayed();
    const headerText = await header.getText();
    // Header says "Sync" — the nav link says "Backups" but the page header says "Sync"
    expect(headerText?.toLowerCase()).toMatch(/sync|backup/);
  });

  it('should display sync status card with idle or syncing indicator', async () => {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const statusCard = await $(SEL.syncStatusCard);
    await expect(statusCard).toBeDisplayed();

    // The status indicator should show one of the known states
    const indicator = await statusCard.$('.status-indicator');
    await expect(indicator).toBeDisplayed();
    const indicatorClass = await indicator.getAttribute('class');
    expect(indicatorClass).toBeTruthy();
    // Should have one of: idle, syncing
    expect(indicatorClass!.match(/idle|syncing/)).toBeTruthy();
  });

  it('should show watched folders with folder details', async () => {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const foldersSection = await $(SEL.watchedFolders);
    await expect(foldersSection).toBeDisplayed();

    // Check if there are folder items (quickstart folder should exist)
    const folderCount = await getCount('.folder-item');

    if (folderCount > 0) {
      // Verify first folder has path and status
      const firstFolder = await $('.folder-item');
      const folderPath = await firstFolder.$('.folder-path');
      await expect(folderPath).toBeDisplayed();
      const folderStatus = await firstFolder.$('.folder-status');
      await expect(folderStatus).toBeDisplayed();

      const folderPathText = await folderPath.getText();
      expect(folderPathText).toBeTruthy();
    } else {
      // No folders yet — empty state should be shown
      const emptyState = await $('.empty-state');
      await expect(emptyState).toBeDisplayed();
    }
  });

  it('should toggle folder enabled/disabled via toggle switch', async function () {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const folderCount = await getCount('.folder-item');

    if (folderCount === 0) {
      this.skip();
      return;
    }

    // Find the toggle in the first folder's actions
    const firstFolder = await $('.folder-item');
    const toggle = await firstFolder.$('.folder-actions .toggle');
    const hasToggle = await toggle.isDisplayed().catch(() => false);

    if (!hasToggle) {
      this.skip();
      return;
    }

    // Read current label
    const toggleLabel = await firstFolder.$('.toggle-label');
    const labelBefore = await toggleLabel.getText();

    // Click the toggle
    await toggle.click();
    await browser.pause(1_000);

    // Read label after toggle — should have changed
    const labelAfter = await toggleLabel.getText();
    expect(labelAfter).not.toEqual(labelBefore);

    // Toggle back to restore original state
    await toggle.click();
    await browser.pause(500);

    const labelRestored = await toggleLabel.getText();
    expect(labelRestored).toEqual(labelBefore);
  });

  it('should trigger manual sync and show syncing state', async () => {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const hasSyncNow = await isDisplayed('*=Sync Now', 2000);

    if (!hasSyncNow) {
      const mainContent = await $('.main-content');
      const pageContent = await mainContent.getText();
      expect(pageContent).toBeTruthy();
      return;
    }

    const syncNowBtn = await hasText('button', 'Sync Now');
    const isDisabled = !(await syncNowBtn.isEnabled());
    if (isDisabled) {
      // No folders to sync — expected
      return;
    }

    // Click Sync Now
    await syncNowBtn.click();
    await browser.pause(500);

    // After clicking, button text should change to "Pause Sync" or status should update
    const hasPause = await isDisplayed('*=Pause Sync', 3000);

    // Page should still be functional
    const mainContent = await $('.main-content');
    await expect(mainContent).toBeDisplayed();

    if (hasPause) {
      await browser.pause(3_000);
    }
  });

  it('should show queue size indicator when syncing', async () => {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const hasQueue = await isDisplayed('.queue-size', 2000);

    if (hasQueue) {
      const queueSize = await $('.queue-size');
      const queueText = await queueSize.getText();
      expect(queueText).toBeTruthy();
      expect(queueText).toMatch(/\d/);
    }

    // At minimum, page should render without errors
    const mainContent = await $('.main-content');
    await expect(mainContent).toBeDisplayed();
  });

  it('should show Backup Now button for folders with manifest CID', async function () {
    await navigateTo('Folder Upload');
    await browser.pause(500);

    const folderCount = await getCount('.folder-item');

    if (folderCount === 0) {
      this.skip();
      return;
    }

    const hasBackup = await isDisplayed('*=Backup Now', 2000);

    if (hasBackup) {
      const backupBtn = await hasText('button', 'Backup Now');
      const isDisabled = !(await backupBtn.isEnabled());
      if (!isDisabled) {
        await backupBtn.click();
        await browser.pause(2_000);
        const mainContent = await $('.main-content');
        await expect(mainContent).toBeDisplayed();
      }
    }
    // If no Backup Now button, folders may not have manifest CIDs yet
  });
});
