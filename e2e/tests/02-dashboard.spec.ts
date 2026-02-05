import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  apiDebugInfo,
  navigateTo,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Dashboard functional tests (Playwright via CDP)
 *
 * Assumes onboarding is complete and node is running.
 */

test.describe('Dashboard', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
    // Ensure sidecar API is also up
    await waitForPort(8080, 15_000);
  });

  test('should display dashboard with node status indicators', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Dashboard');

      // Wait a moment for page to render
      await page.waitForTimeout(500);

      // Page header
      await expect(page.locator(SEL.pageHeader)).toHaveText('Dashboard', { timeout: 5_000 });

      // Status hero section should be visible (may not exist in all view modes)
      // First check if we're in basic or advanced view
      const statusHero = page.locator(SEL.statusHero);
      const hasStatusHero = await statusHero.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasStatusHero) {
        await expect(statusHero).toBeVisible();
      }

      // Node should show "Running" status somewhere on the page
      // Could be in BasicView (.status-text) or AdvancedView (.stat-value or elsewhere)
      const runningIndicator = page.locator('text=Running').first();
      await expect(runningIndicator).toBeVisible({ timeout: 10_000 });

      // Quick stats should be visible in BasicView, or stat-cards in AdvancedView
      const quickStats = page.locator(SEL.quickStats);
      const statCards = page.locator('.stat-card');
      const hasQuickStats = await quickStats.isVisible({ timeout: 2000 }).catch(() => false);
      const hasStatCards = await statCards.first().isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasQuickStats || hasStatCards, 'Either quick-stats or stat-cards should be visible').toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should show correct view mode toggles', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Dashboard');

      // View mode toggle buttons exist
      const basicBtn = page.locator(SEL.viewModeBasic);
      const advancedBtn = page.locator(SEL.viewModeAdvanced);
      await expect(basicBtn).toBeVisible();
      await expect(advancedBtn).toBeVisible();

      // Switch to Advanced view
      await advancedBtn.click();
      await expect(page.locator('.advanced-view')).toBeVisible({ timeout: 3_000 });

      // Should show stat cards
      await expect(page.locator('.stat-card')).toHaveCount(4, { timeout: 3_000 });

      // Switch back to Basic
      await basicBtn.click();
      await expect(page.locator('.basic-view')).toBeVisible({ timeout: 3_000 });
    } finally {
      await browser.close();
    }
  });

  test('should run diagnostics and display results', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Dashboard');

      // Switch to Advanced view to access diagnostics
      await page.locator(SEL.viewModeAdvanced).click();
      await expect(page.locator('.advanced-view')).toBeVisible({ timeout: 3_000 });

      // Open diagnostics panel
      const diagToggle = page.locator(SEL.diagnosticsToggle);
      await expect(diagToggle).toBeVisible();
      await diagToggle.click();

      // Click "Run Diagnostics"
      const runBtn = page.locator(SEL.runDiagnostics);
      await expect(runBtn).toBeVisible({ timeout: 3_000 });
      await runBtn.click();

      // Wait for results
      await expect(page.locator(SEL.diagnosticResults)).toBeVisible({ timeout: 15_000 });

      // Verify at least one diagnostic item shows success (API reachable, version, peer ID, etc.)
      const successItems = page.locator('.diagnostic-item.success');
      await expect(successItems.first()).toBeVisible({ timeout: 5_000 });
      expect(await successItems.count()).toBeGreaterThanOrEqual(1);
    } finally {
      await browser.close();
    }
  });

  test('should cross-check dashboard values against /debug/info API', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Dashboard');

      // Get data from API
      const info = await apiDebugInfo();
      expect(info.id).toBeTruthy();

      // Switch to Advanced view to see peer ID
      await page.locator(SEL.viewModeAdvanced).click();
      await expect(page.locator('.advanced-view')).toBeVisible({ timeout: 3_000 });

      // Verify peer ID is displayed (truncated in UI) — use .first() to avoid strict mode
      const peerIdPrefix = info.id.substring(0, 10);
      await expect(page.locator(`text=${peerIdPrefix}`).first()).toBeVisible({ timeout: 5_000 });

      // Verify version is displayed (if present)
      if (info.archivist?.version) {
        await expect(
          page.locator(`text=${info.archivist.version}`),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await browser.close();
    }
  });
});
