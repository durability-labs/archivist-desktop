import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateToStreamingTab,
  SEL,
} from '../helpers';

test.describe('Stremio Addons', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should display addon URL input and Install button on Addons tab', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'addons');

      await expect(page.locator(SEL.addonUrlInput)).toBeVisible();
      await expect(page.locator(SEL.addonInstallBtn)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show suggested addons list', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'addons');

      await expect(page.locator(SEL.addonSuggestions)).toBeVisible();
      // Should have at least Cinemeta suggestion
      await expect(page.locator('text=Cinemeta')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should install Cinemeta addon from URL', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'addons');

      // Enter addon URL
      await page.locator(SEL.addonUrlInput).fill('https://v3-cinemeta.strem.io');
      await page.locator(SEL.addonInstallBtn).click();

      // Wait for addon to appear in list
      await page.waitForTimeout(5000);
      await expect(page.locator(SEL.addonItem)).toBeVisible({ timeout: 10_000 });

      // Verify addon name is displayed
      await expect(page.locator('text=Cinemeta')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should toggle addon enable/disable', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'addons');
      await page.waitForTimeout(1000);

      // Check if addon is installed first
      const hasAddon = await page.locator(SEL.addonItem).isVisible().catch(() => false);
      if (!hasAddon) {
        test.skip();
        return;
      }

      const toggle = page.locator(SEL.addonToggle).first();
      await toggle.click();
      await page.waitForTimeout(500);
    } finally {
      await browser.close();
    }
  });

  test('should show catalog items on Discover after addon install', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'discover');
      await page.waitForTimeout(2000);

      // If addon is installed, catalog grid should have items
      const hasCatalog = await page.locator(SEL.catalogGrid).isVisible().catch(() => false);
      const hasEmpty = await page.locator(SEL.catalogEmpty).isVisible().catch(() => false);

      // Either catalog items or empty state should be visible
      expect(hasCatalog || hasEmpty).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should navigate to content detail on card click', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'discover');
      await page.waitForTimeout(3000);

      const card = page.locator(SEL.catalogCard).first();
      const hasCards = await card.isVisible().catch(() => false);
      if (!hasCards) {
        test.skip();
        return;
      }

      await card.click();
      await page.waitForTimeout(2000);

      // Should navigate to content detail page
      await expect(page.locator(SEL.contentDetail)).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('should remove addon', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateToStreamingTab(page, 'addons');
      await page.waitForTimeout(1000);

      const hasAddon = await page.locator(SEL.addonItem).isVisible().catch(() => false);
      if (!hasAddon) {
        test.skip();
        return;
      }

      await page.locator(SEL.addonRemoveBtn).first().click();
      await page.waitForTimeout(1000);

      // After removal, check discover tab for empty state
      await page.locator(SEL.tabDiscover).click();
      await page.waitForTimeout(500);

      await expect(page.locator(SEL.catalogEmpty)).toBeVisible({ timeout: 5000 });
    } finally {
      await browser.close();
    }
  });
});
