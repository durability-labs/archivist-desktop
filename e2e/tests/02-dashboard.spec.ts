import {
  waitForPort,
  apiDebugInfo,
  navigateTo,
  isDisplayed,
  hasText,
  getCount,
  SEL,
} from '../helpers';

/**
 * Phase 3 — Dashboard functional tests (WebdriverIO + tauri-driver)
 *
 * Assumes onboarding is complete and node is running.
 */

describe('Dashboard', () => {
  before(async () => {
    await waitForPort(8080, 15_000);
  });

  it('should display dashboard with node status indicators', async () => {
    await navigateTo('Dashboard');

    // Wait a moment for page to render
    await browser.pause(500);

    // Page header
    const header = await $(SEL.pageHeader);
    await expect(header).toHaveText('Dashboard', { wait: 5_000 });

    // Status hero section should be visible (may not exist in all view modes)
    const hasStatusHero = await isDisplayed(SEL.statusHero, 3000);
    if (hasStatusHero) {
      const statusHero = await $(SEL.statusHero);
      await expect(statusHero).toBeDisplayed();
    }

    // Node should show "Running" status somewhere on the page
    const runningIndicator = await $('*=Running');
    await expect(runningIndicator).toBeDisplayed({ wait: 10_000 });

    // Quick stats should be visible in BasicView, or stat-cards in AdvancedView
    const hasQuickStats = await isDisplayed(SEL.quickStats, 2000);
    const hasStatCards = await isDisplayed('.stat-card', 2000);
    expect(hasQuickStats || hasStatCards).toBeTruthy();
  });

  it('should show correct view mode toggles', async () => {
    await navigateTo('Dashboard');

    // View mode toggle buttons exist
    const basicBtn = await $(SEL.viewModeBasic);
    const advancedBtn = await $(SEL.viewModeAdvanced);
    await expect(basicBtn).toBeDisplayed();
    await expect(advancedBtn).toBeDisplayed();

    // Switch to Advanced view
    await advancedBtn.click();
    const advancedView = await $('.advanced-view');
    await expect(advancedView).toBeDisplayed({ wait: 3_000 });

    // Should show stat cards
    await expect(await $$('.stat-card')).toBeElementsArrayOfSize(4, { wait: 3_000 });

    // Switch back to Basic
    await basicBtn.click();
    const basicView = await $('.basic-view');
    await expect(basicView).toBeDisplayed({ wait: 3_000 });
  });

  it('should run diagnostics and display results', async () => {
    await navigateTo('Dashboard');

    // Switch to Advanced view to access diagnostics
    const advancedBtn = await $(SEL.viewModeAdvanced);
    await advancedBtn.click();
    const advancedView = await $('.advanced-view');
    await expect(advancedView).toBeDisplayed({ wait: 3_000 });

    // Open diagnostics panel
    const diagToggle = await $(SEL.diagnosticsToggle);
    await expect(diagToggle).toBeDisplayed();
    await diagToggle.click();

    // Click "Run Diagnostics"
    const runBtn = await $(SEL.runDiagnostics);
    await expect(runBtn).toBeDisplayed({ wait: 3_000 });
    await runBtn.click();

    // Wait for results
    const diagResults = await $(SEL.diagnosticResults);
    await expect(diagResults).toBeDisplayed({ wait: 15_000 });

    // Verify at least one diagnostic item shows success
    const successItem = await $('.diagnostic-item.success');
    await expect(successItem).toBeDisplayed({ wait: 5_000 });
    const successCount = await getCount('.diagnostic-item.success');
    expect(successCount).toBeGreaterThanOrEqual(1);
  });

  it('should cross-check dashboard values against /debug/info API', async () => {
    await navigateTo('Dashboard');

    // Get data from API
    const info = await apiDebugInfo();
    expect(info.id).toBeTruthy();

    // Switch to Advanced view to see peer ID
    const advancedBtn = await $(SEL.viewModeAdvanced);
    await advancedBtn.click();
    const advancedView = await $('.advanced-view');
    await expect(advancedView).toBeDisplayed({ wait: 3_000 });

    // Verify peer ID is displayed (truncated in UI)
    const peerIdPrefix = info.id.substring(0, 10);
    const peerIdEl = await $(`*=${peerIdPrefix}`);
    await expect(peerIdEl).toBeDisplayed({ wait: 5_000 });

    // Verify version is displayed (if present)
    if (info.archivist?.version) {
      const versionEl = await $(`*=${info.archivist.version}`);
      await expect(versionEl).toBeDisplayed({ wait: 5_000 });
    }
  });
});
