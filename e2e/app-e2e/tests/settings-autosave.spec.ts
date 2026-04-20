/**
 * End-to-end regression for Settings auto-save.
 *
 * Verifies the removed-Save-button behavior against the REAL app: changing a
 * Settings value triggers a backend save within the debounce window, and
 * reloading the app shows the persisted value.
 */
import { test, expect, skipIntroCards } from '../fixtures/app';
import { navigateTo } from '../fixtures/appHelpers';

test.describe('Settings — auto-save (real backend)', () => {
  test('no "Save Settings" button is rendered; auto-save status hint is', async ({ page }) => {
    await navigateTo(page, 'Settings');
    await expect(page.locator('button', { hasText: 'Save Settings' })).toHaveCount(0);
    await expect(page.locator('.settings-status')).toBeVisible();
    await expect(page.locator('.settings-status')).toContainText(/save/i);
  });

  test('changing a Settings value persists without a save click', async ({ page }) => {
    await navigateTo(page, 'Settings');

    // Change log level (it's a <select> in the Node section)
    // The label text is "Log Level" in Settings.tsx.
    const logLevelLabel = page.locator('label', { hasText: /^Log Level$/ }).first();
    const logLevelSelect = logLevelLabel.locator('xpath=following::select[1]');
    await expect(logLevelSelect).toBeVisible({ timeout: 10_000 });

    const originalValue = await logLevelSelect.inputValue();
    const newValue = originalValue === 'INFO' ? 'DEBUG' : 'INFO';
    await logLevelSelect.selectOption(newValue);

    // Status should flip to "Saving…" then back to the idle hint.
    // (Debounce is ~600ms, save is fast locally, so the Saving… state may be
    // very brief. We assert the final state is stable at the idle text.)
    await page.waitForTimeout(1500);
    await expect(page.locator('.settings-status')).toContainText(/save/i);

    // Reload — the value should persist. Intro cards play every launch; set
    // the test-skip-splash flag so we only click through disclaimer + welcome.
    await page.evaluate(() => {
      sessionStorage.setItem('__archivist_test_skip_splash', 'true');
    }).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await skipIntroCards(page);
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 10_000 });
    await navigateTo(page, 'Settings');

    const logLevelLabelAfter = page.locator('label', { hasText: /^Log Level$/ }).first();
    const logLevelSelectAfter = logLevelLabelAfter.locator('xpath=following::select[1]');
    await expect(logLevelSelectAfter).toHaveValue(newValue);
  });
});
