import {
  waitForPort,
  navigateTo,
  sleep,
  hasText,
  hasTextChild,
  waitAndAcceptAlert,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Settings page functional tests (WebdriverIO + tauri-driver)
 */

describe('Settings page', () => {
  before(async () => {
    await waitForPort(8080, 15_000);
  });

  it('should display Settings page with default values loaded', async () => {
    await navigateTo('Settings');

    const header = await $(SEL.settingsHeader);
    await expect(header).toHaveText('Settings');

    // Verify Node section exists
    const nodeHeading = await hasText('h3', 'Node');
    await expect(nodeHeading).toBeDisplayed();

    // Default ports should be populated
    // API Port = 8080
    const apiPortInput = await hasTextChild('.setting-row .setting-item', 'API Port', 'input[type="number"]');
    await expect(apiPortInput).toHaveValue('8080');

    // Discovery Port = 8090
    const discPortInput = await hasTextChild('.setting-row .setting-item', 'Discovery Port', 'input[type="number"]');
    await expect(discPortInput).toHaveValue('8090');

    // Listen Port = 8070
    const listenPortInput = await hasTextChild('.setting-row .setting-item', 'Listen Port', 'input[type="number"]');
    await expect(listenPortInput).toHaveValue('8070');
  });

  it('should save a non-critical setting change', async () => {
    await navigateTo('Settings');

    // Change Max Storage from default (10) to 15
    const maxStorageInput = await hasTextChild('.setting-item', 'Max Storage', 'input[type="number"]');
    await expect(maxStorageInput).toBeDisplayed();
    const originalValue = await maxStorageInput.getValue();

    await maxStorageInput.setValue('15');

    // Click Save
    const saveBtn = await hasText('button', 'Save Settings');
    await saveBtn.click();

    // Assert success banner
    const successBanner = await $(SEL.successBanner);
    await expect(successBanner).toBeDisplayed({ wait: 5_000 });
    await expect(successBanner).toHaveText('Settings saved successfully!');

    // Restore original value
    await maxStorageInput.setValue(originalValue);
    await saveBtn.click();
    await expect(successBanner).toBeDisplayed({ wait: 5_000 });
  });

  it('should persist setting across page reload', async () => {
    await navigateTo('Settings');

    // Change log level to INFO
    const logLevelSelect = await hasTextChild('.setting-item', 'Log Level', 'select');
    await expect(logLevelSelect).toBeDisplayed();
    const originalLevel = await logLevelSelect.getValue();

    await logLevelSelect.selectByAttribute('value', 'INFO');

    // Save
    const saveBtn = await hasText('button', 'Save Settings');
    await saveBtn.click();
    const successBanner = await $(SEL.successBanner);
    await expect(successBanner).toBeDisplayed({ wait: 5_000 });

    // Navigate away and back
    await navigateTo('Dashboard');
    await sleep(1000);
    await navigateTo('Settings');

    // Verify persisted
    const logLevelSelectAfter = await hasTextChild('.setting-item', 'Log Level', 'select');
    await expect(logLevelSelectAfter).toHaveValue('INFO', { wait: 5_000 });

    // Restore original
    await logLevelSelectAfter.selectByAttribute('value', originalLevel);
    const saveBtnAfter = await hasText('button', 'Save Settings');
    await saveBtnAfter.click();
    const successBannerAfter = await $(SEL.successBanner);
    await expect(successBannerAfter).toBeDisplayed({ wait: 5_000 });
  });

  it('should reset settings to defaults', async () => {
    await navigateTo('Settings');

    // Change something first
    const maxStorageInput = await hasTextChild('.setting-item', 'Max Storage', 'input[type="number"]');
    await maxStorageInput.setValue('99');
    const saveBtn = await hasText('button', 'Save Settings');
    await saveBtn.click();
    const successBanner = await $(SEL.successBanner);
    await expect(successBanner).toBeDisplayed({ wait: 5_000 });

    // Click Reset to Defaults — handle the confirmation dialog
    const resetBtn = await hasText('button', 'Reset to Defaults');
    await resetBtn.click();
    await waitAndAcceptAlert(5000);

    // Assert success banner appears again
    await expect(successBanner).toBeDisplayed({ wait: 5_000 });

    // Verify max storage is back to default (10)
    const maxStorageInputAfter = await hasTextChild('.setting-item', 'Max Storage', 'input[type="number"]');
    await expect(maxStorageInputAfter).toHaveValue('10', { wait: 5_000 });
  });
});
