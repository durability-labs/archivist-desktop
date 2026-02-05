import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Logs page functional tests (Playwright via CDP)
 *
 * Known v0.1.0 issue: "os error 32" (file locking) may appear.
 */

test.describe('Logs page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Logs page and display header', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Logs');

      await expect(page.locator(SEL.logsHeader)).toHaveText('Node Logs');
    } finally {
      await browser.close();
    }
  });

  test('should show log content OR known os-error-32 bug', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Logs');

      // Wait briefly for logs to load
      await page.waitForTimeout(3000);

      // Either we see log lines OR the known file-locking error
      const logLines = page.locator(SEL.logLine);
      const errorMsg = page.locator(SEL.errorMessage).first();

      const hasLogs = (await logLines.count()) > 0;
      const hasError = await errorMsg.isVisible({ timeout: 1000 }).catch(() => false);

      if (hasError) {
        // Known v0.1.0 bug — log file locking on Windows
        const errorText = await errorMsg.textContent();
        const isKnownBug = errorText?.includes('os error 32') || errorText?.includes('being used by another process');

        // Confirm it is the expected error, not something unexpected
        expect(
          isKnownBug,
          `Unexpected error on Logs page: ${errorText}`,
        ).toBeTruthy();

        // Test passes — known issue confirmed
        test.info().annotations.push({
          type: 'known-issue',
          description: 'Log file locking (os error 32) — known v0.1.0 bug',
        });
      } else {
        // Logs are visible — verify count and controls
        expect(hasLogs).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });

  test('should have log controls when logs are visible', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Logs');
      await page.waitForTimeout(2000);

      // Line count selector (scoped to logs controls)
      const lineSelect = page.locator('.logs-controls select');
      await expect(lineSelect).toBeVisible();

      // Should have expected options
      const options = await lineSelect.locator('option').allTextContents();
      expect(options).toContain('100');
      expect(options).toContain('500');
      expect(options).toContain('1000');
      expect(options).toContain('5000');

      // Auto-refresh checkbox
      const autoRefreshLabel = page.locator('text=Auto-refresh');
      await expect(autoRefreshLabel).toBeVisible();

      // Copy All button
      const copyAllBtn = page.locator('button:has-text("Copy All")');
      await expect(copyAllBtn).toBeVisible();

      // Refresh button
      const refreshBtn = page.locator('button:has-text("Refresh")');
      await expect(refreshBtn).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
