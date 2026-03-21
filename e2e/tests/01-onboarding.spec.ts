import {
  waitForPort,
  sleep,
  navigateTo,
  hasText,
  isDisplayed,
  SEL,
} from '../helpers';

/**
 * Phase 2 — Startup & Onboarding (WebdriverIO + tauri-driver)
 *
 * These tests verify the onboarding flow OR confirm the main app is accessible.
 * Since onboarding may have been completed in a previous run, we handle both cases.
 */

describe('Onboarding flow', () => {
  before(async () => {
    await waitForPort(8080, 30_000);
  });

  it('should show onboarding screens OR main app if already completed', async () => {
    // Check if we're in onboarding or in the main app
    // Wait for either onboarding or sidebar to appear
    await browser.waitUntil(
      async () => {
        const onboardingVisible = await isDisplayed(
          `${SEL.splashScreen}, ${SEL.welcomeScreen}, ${SEL.nodeStartingScreen}, ${SEL.folderSelectScreen}, ${SEL.syncingScreen}`,
          1000,
        );
        const mainAppVisible = await isDisplayed(SEL.sidebar, 1000);
        return onboardingVisible || mainAppVisible;
      },
      { timeout: 15_000, timeoutMsg: 'Neither onboarding nor main app appeared within 15s' },
    );

    const inOnboarding = await isDisplayed(
      `${SEL.splashScreen}, ${SEL.welcomeScreen}, ${SEL.nodeStartingScreen}, ${SEL.folderSelectScreen}, ${SEL.syncingScreen}`,
      1000,
    );
    const inMainApp = await isDisplayed(SEL.sidebar, 1000);

    expect(inOnboarding || inMainApp).toBeTruthy();
  });

  it('should complete onboarding if in progress, or verify main app accessible', async () => {
    // Handle splash screen
    if (await isDisplayed(SEL.splashScreen, 2000)) {
      const skipBtn = await $(SEL.splashSkip);
      if (await skipBtn.waitForDisplayed({ timeout: 2000 }).then(() => true).catch(() => false)) {
        await skipBtn.click();
        await sleep(1000);
      }
    }

    // Handle welcome screen
    if (await isDisplayed(SEL.welcomeScreen, 2000)) {
      const getStartedBtn = await $(SEL.getStarted);
      await getStartedBtn.click();
      await sleep(1000);
    }

    // Handle node-starting screen
    if (await isDisplayed(SEL.nodeStartingScreen, 2000)) {
      const nodeReady = await $(SEL.nodeStatusReady);
      await nodeReady.waitForDisplayed({ timeout: 60_000 });
    }

    // Handle folder-select screen
    if (await isDisplayed(SEL.folderSelectScreen, 2000)) {
      const quickBackup = await $(SEL.quickBackupBtn);
      await quickBackup.click();
      await sleep(1000);
    }

    // Handle syncing screen
    if (await isDisplayed(SEL.syncingScreen, 2000)) {
      const backupComplete = await $('*=Backup complete!');
      await backupComplete.waitForDisplayed({ timeout: 30_000 });
      const continueBtn = await $(SEL.continueBtn);
      if (await continueBtn.waitForDisplayed({ timeout: 3000 }).then(() => true).catch(() => false)) {
        await continueBtn.click();
      }
    }

    // At this point we should be in the main app
    const sidebar = await $(SEL.sidebar);
    await expect(sidebar).toBeDisplayed({ wait: 10_000 });
  });

  it('should have sidebar visible with navigation links', async () => {
    // Should be in main app now
    const sidebar = await $(SEL.sidebar);
    await expect(sidebar).toBeDisplayed({ wait: 5_000 });

    // Core nav links should be visible
    const dashboardLink = await hasText('.sidebar .nav-link', 'Dashboard');
    await expect(dashboardLink).toBeDisplayed();

    const uploadLink = await hasText('.sidebar .nav-link', 'Upload & Download');
    await expect(uploadLink).toBeDisplayed();

    const torrentsLink = await hasText('.sidebar .nav-link', 'Torrents');
    await expect(torrentsLink).toBeDisplayed();
  });

  it('should display Dashboard page by default', async () => {
    // Dashboard should be accessible
    const dashLink = await hasText('.sidebar .nav-link', 'Dashboard');
    await dashLink.click();
    await browser.pause(500);

    const header = await $(SEL.pageHeader);
    await expect(header).toHaveText('Dashboard', { wait: 5_000 });
  });
});
