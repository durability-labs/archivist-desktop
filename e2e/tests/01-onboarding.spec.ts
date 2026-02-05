import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  sleep,
  SEL,
} from '../helpers';

/**
 * Phase 2 — Startup & Onboarding (Playwright via CDP)
 *
 * These tests verify the onboarding flow OR confirm the main app is accessible.
 * Since onboarding may have been completed in a previous run, we handle both cases.
 */

test.describe.serial('Onboarding flow', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 30_000);
    // Also wait for sidecar
    await waitForPort(8080, 30_000);
  });

  test('should show onboarding screens OR main app if already completed', async () => {
    const { browser, page } = await connectToApp();

    try {
      // Check if we're in onboarding or in the main app
      const onboardingScreens = page.locator(
        `${SEL.splashScreen}, ${SEL.welcomeScreen}, ${SEL.nodeStartingScreen}, ${SEL.folderSelectScreen}, ${SEL.syncingScreen}`,
      );
      const mainApp = page.locator(SEL.sidebar);

      // One of these should be visible within 15 seconds
      await expect(
        onboardingScreens.first().or(mainApp)
      ).toBeVisible({ timeout: 15_000 });

      // Store which mode we're in for subsequent tests
      const inOnboarding = await onboardingScreens.first().isVisible({ timeout: 1000 }).catch(() => false);
      const inMainApp = await mainApp.isVisible({ timeout: 1000 }).catch(() => false);

      if (inOnboarding) {
        test.info().annotations.push({ type: 'mode', description: 'onboarding' });
      } else if (inMainApp) {
        test.info().annotations.push({ type: 'mode', description: 'main-app' });
      }

      expect(inOnboarding || inMainApp).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should complete onboarding if in progress, or verify main app accessible', async () => {
    const { browser, page } = await connectToApp();

    try {
      // Check current state
      const splash = page.locator(SEL.splashScreen);
      const welcome = page.locator(SEL.welcomeScreen);
      const nodeStarting = page.locator(SEL.nodeStartingScreen);
      const folderSelect = page.locator(SEL.folderSelectScreen);
      const syncing = page.locator(SEL.syncingScreen);
      const sidebar = page.locator(SEL.sidebar);

      // Handle splash screen
      if (await splash.isVisible({ timeout: 2000 }).catch(() => false)) {
        const skipBtn = page.locator(SEL.splashSkip);
        if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await skipBtn.click();
          await sleep(1000);
        }
      }

      // Handle welcome screen
      if (await welcome.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.locator(SEL.getStarted).click();
        await sleep(1000);
      }

      // Handle node-starting screen
      if (await nodeStarting.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(page.locator(SEL.nodeStatusReady)).toBeVisible({ timeout: 60_000 });
      }

      // Handle folder-select screen
      if (await folderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.locator(SEL.quickBackupBtn).click();
        await sleep(1000);
      }

      // Handle syncing screen
      if (await syncing.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(page.locator('text=Backup complete!')).toBeVisible({ timeout: 30_000 });
        const continueBtn = page.locator(SEL.continueBtn);
        if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await continueBtn.click();
        }
      }

      // At this point we should be in the main app
      await expect(sidebar).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('should have sidebar visible with navigation links', async () => {
    const { browser, page } = await connectToApp();

    try {
      // Should be in main app now
      await expect(page.locator(SEL.sidebar)).toBeVisible({ timeout: 5_000 });

      // Core nav links should be visible
      await expect(page.locator('.sidebar .nav-link:has-text("Dashboard")')).toBeVisible();
      await expect(page.locator('.sidebar .nav-link:has-text("Backups")')).toBeVisible();
      await expect(page.locator('.sidebar .nav-link:has-text("Restore")')).toBeVisible();
      await expect(page.locator('.sidebar .nav-link:has-text("My Devices")')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display Dashboard page by default', async () => {
    const { browser, page } = await connectToApp();

    try {
      // Dashboard should be accessible
      await page.locator('.sidebar .nav-link:has-text("Dashboard")').click();
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SEL.pageHeader)).toHaveText('Dashboard', { timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });
});
