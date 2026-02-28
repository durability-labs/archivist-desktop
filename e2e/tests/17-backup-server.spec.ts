import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Backup Server page — daemon lifecycle tests with deep UI interaction.
 */
test.describe('Backup Server page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should navigate to Backup Server page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      await expect(page.locator(SEL.backupServerPage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should display page header', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      const header = page.locator(SEL.backupServerHeader).first();
      await expect(header).toBeVisible();
      const text = await header.textContent();
      expect(text?.toLowerCase()).toContain('backup');
    } finally {
      await browser.close();
    }
  });

  test('should show stats cards with values', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      // Stats grid should always be visible
      const statsGrid = page.locator(SEL.backupStatsGrid);
      await expect(statsGrid).toBeVisible();

      // Should have 4 stat cards
      const statCards = page.locator(SEL.backupStatsCard);
      const cardCount = await statCards.count();
      expect(cardCount).toBe(4);

      // Each card should have a label and value
      for (let i = 0; i < cardCount; i++) {
        const card = statCards.nth(i);
        const label = card.locator('.stat-label');
        const value = card.locator('.stat-value');
        await expect(label).toBeVisible();
        await expect(value).toBeVisible();

        const valueText = await value.textContent();
        expect(valueText).toBeTruthy();
      }
    } finally {
      await browser.close();
    }
  });

  test('should show configuration section', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      const configGrid = page.locator(SEL.backupConfigGrid);
      const hasConfig = await configGrid.isVisible().catch(() => false);

      if (hasConfig) {
        const configItems = page.locator('.config-item');
        const itemCount = await configItems.count();
        expect(itemCount).toBeGreaterThanOrEqual(3);

        const firstLabel = configItems.first().locator('.config-label');
        const firstValue = configItems.first().locator('.config-value');
        await expect(firstLabel).toBeVisible();
        await expect(firstValue).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should enable daemon and verify UI updates', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      const enableBtn = page.locator('button:has-text("Enable Daemon")');
      const hasEnable = await enableBtn.isVisible().catch(() => false);

      if (hasEnable) {
        await enableBtn.click();
        await expect(enableBtn).not.toBeVisible({ timeout: 10_000 });

        // After enabling: Pause, Resume, and Disable Daemon buttons should appear
        await expect(page.locator('button:has-text("Pause")')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('button:has-text("Disable Daemon")')).toBeVisible();

        // Info banner should disappear
        const infoBanner = page.locator(SEL.backupInfoBanner);
        await expect(infoBanner).not.toBeVisible();
      } else {
        // Daemon already enabled
        await expect(page.locator('button:has-text("Pause"), button:has-text("Resume")')).toBeVisible();
        await expect(page.locator('button:has-text("Disable Daemon")')).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should pause and resume daemon', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      // Ensure daemon is enabled
      const enableBtn = page.locator('button:has-text("Enable Daemon")');
      if (await enableBtn.isVisible().catch(() => false)) {
        await enableBtn.click();
        await expect(enableBtn).not.toBeVisible({ timeout: 10_000 });
      }

      // Click Pause
      const pauseBtn = page.locator('button:has-text("Pause")');
      if (await pauseBtn.isVisible().catch(() => false)) {
        await pauseBtn.click();
        await page.waitForTimeout(2_000);
        await expect(page.locator(SEL.backupServerPage)).toBeVisible();

        // Click Resume
        const resumeBtn = page.locator('button:has-text("Resume")');
        if (await resumeBtn.isVisible().catch(() => false)) {
          await resumeBtn.click();
          await page.waitForTimeout(2_000);
          await expect(page.locator(SEL.backupServerPage)).toBeVisible();
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should disable daemon and verify info banner returns', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1_000);

      const disableBtn = page.locator('button:has-text("Disable Daemon")');
      const hasDisable = await disableBtn.isVisible().catch(() => false);

      if (hasDisable) {
        await disableBtn.click();
        await expect(disableBtn).not.toBeVisible({ timeout: 10_000 });

        // Enable Daemon button should reappear
        await expect(page.locator('button:has-text("Enable Daemon")')).toBeVisible({ timeout: 5_000 });

        // Info banner should reappear
        const infoBanner = page.locator(SEL.backupInfoBanner);
        await expect(infoBanner).toBeVisible();
        const bannerText = await infoBanner.textContent();
        expect(bannerText?.toLowerCase()).toContain('disabled');
      } else {
        // Daemon already disabled
        await expect(page.locator('button:has-text("Enable Daemon")')).toBeVisible();
        const infoBanner = page.locator(SEL.backupInfoBanner);
        await expect(infoBanner).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });
});
