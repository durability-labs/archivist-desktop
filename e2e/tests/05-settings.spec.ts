import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  sleep,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Settings page functional tests (Playwright via CDP)
 */

test.describe('Settings page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display Settings page with default values loaded', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Settings');

      await expect(page.locator(SEL.settingsHeader)).toHaveText('Settings');

      // Verify Node section exists
      await expect(page.locator('h3:has-text("Node")')).toBeVisible();

      // Default ports should be populated
      // API Port = 8080
      const apiPortInput = page.locator('.setting-row .setting-item:has-text("API Port") input[type="number"]');
      await expect(apiPortInput).toHaveValue('8080');

      // Discovery Port = 8090
      const discPortInput = page.locator('.setting-row .setting-item:has-text("Discovery Port") input[type="number"]');
      await expect(discPortInput).toHaveValue('8090');

      // Listen Port = 8070
      const listenPortInput = page.locator('.setting-row .setting-item:has-text("Listen Port") input[type="number"]');
      await expect(listenPortInput).toHaveValue('8070');
    } finally {
      await browser.close();
    }
  });

  test('should save a non-critical setting change', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Settings');

      // Change Max Storage from default (10) to 15
      const maxStorageInput = page.locator('.setting-item:has-text("Max Storage") input[type="number"]');
      await expect(maxStorageInput).toBeVisible();
      const originalValue = await maxStorageInput.inputValue();

      await maxStorageInput.fill('15');

      // Click Save
      const saveBtn = page.locator('button:has-text("Save Settings")');
      await saveBtn.click();

      // Assert success banner
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(SEL.successBanner)).toHaveText('Settings saved successfully!');

      // Restore original value
      await maxStorageInput.fill(originalValue);
      await saveBtn.click();
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should persist setting across page reload', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Settings');

      // Change log level to INFO
      const logLevelSelect = page.locator('.setting-item:has-text("Log Level") select');
      await expect(logLevelSelect).toBeVisible();
      const originalLevel = await logLevelSelect.inputValue();

      await logLevelSelect.selectOption('INFO');

      // Save
      await page.locator('button:has-text("Save Settings")').click();
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });

      // Navigate away and back
      await navigateTo(page, 'Dashboard');
      await sleep(1000);
      await navigateTo(page, 'Settings');

      // Verify persisted
      await expect(logLevelSelect).toHaveValue('INFO', { timeout: 5_000 });

      // Restore original
      await logLevelSelect.selectOption(originalLevel);
      await page.locator('button:has-text("Save Settings")').click();
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should reset settings to defaults', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Settings');

      // Change something first
      const maxStorageInput = page.locator('.setting-item:has-text("Max Storage") input[type="number"]');
      await maxStorageInput.fill('99');
      await page.locator('button:has-text("Save Settings")').click();
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });

      // Click Reset to Defaults — handle the confirmation dialog
      page.on('dialog', (dialog) => dialog.accept());
      await page.locator('button:has-text("Reset to Defaults")').click();

      // Assert success banner appears again
      await expect(page.locator(SEL.successBanner)).toBeVisible({ timeout: 5_000 });

      // Verify max storage is back to default (10)
      await expect(maxStorageInput).toHaveValue('10', { timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });
});
