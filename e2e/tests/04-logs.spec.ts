import {
  waitForPort,
  navigateTo,
  hasText,
  isDisplayed,
  getCount,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Logs page functional tests (WebdriverIO + tauri-driver)
 *
 * Known v0.1.0 issue: "os error 32" (file locking) may appear.
 */

describe('Logs page', () => {
  before(async () => {
    await waitForPort(8080, 15_000);
  });

  it('should navigate to Logs page and display header', async () => {
    await navigateTo('Logs');

    const header = await $(SEL.logsHeader);
    await expect(header).toHaveText('Node Logs');
  });

  it('should show log content OR known os-error-32 bug', async () => {
    await navigateTo('Logs');

    // Wait briefly for logs to load
    await browser.pause(3000);

    // Either we see log lines OR the known file-locking error
    const hasLogs = (await getCount(SEL.logLine)) > 0;
    const hasError = await isDisplayed(SEL.errorMessage, 1000);

    if (hasError) {
      // Known v0.1.0 bug — log file locking on Windows
      const errorEl = await $(SEL.errorMessage);
      const errorText = await errorEl.getText();
      const isKnownBug = errorText?.includes('os error 32') || errorText?.includes('being used by another process');

      // Confirm it is the expected error, not something unexpected
      expect(isKnownBug).toBeTruthy();
    } else {
      // Logs are visible — verify count and controls
      expect(hasLogs).toBeTruthy();
    }
  });

  it('should have log controls when logs are visible', async () => {
    await navigateTo('Logs');
    await browser.pause(2000);

    // Line count selector (scoped to logs controls)
    const lineSelect = await $('.logs-controls select');
    await expect(lineSelect).toBeDisplayed();

    // Should have expected options
    const options = await $$('.logs-controls select option');
    const optionTexts: string[] = [];
    for (const opt of options) {
      optionTexts.push(await opt.getText());
    }
    expect(optionTexts).toContain('100');
    expect(optionTexts).toContain('500');
    expect(optionTexts).toContain('1000');
    expect(optionTexts).toContain('5000');

    // Auto-refresh checkbox
    const autoRefreshLabel = await $('*=Auto-refresh');
    await expect(autoRefreshLabel).toBeDisplayed();

    // Copy All button
    const copyAllBtn = await hasText('button', 'Copy All');
    await expect(copyAllBtn).toBeDisplayed();

    // Refresh button
    const refreshBtn = await hasText('button', 'Refresh');
    await expect(refreshBtn).toBeDisplayed();
  });
});
