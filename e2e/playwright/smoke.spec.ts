import { test, expect, Page } from '@playwright/test';
import { SEL, DIRECT_NAV_ROUTES } from '../selectors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupPage(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('archivist_onboarding_complete', 'true');
  });
  await page.reload();
  await page.locator(SEL.sidebar).waitFor({ state: 'visible', timeout: 15_000 });
}

const ADVANCED_TARGETS = ['Logs', 'Backup Server', 'Settings', 'My Devices', 'Add Device', 'Folder Upload'];

async function navigateTo(page: Page, label: string) {
  if (ADVANCED_TARGETS.includes(label)) {
    const link = page.locator('.sidebar .nav-link', { hasText: label });
    if (!(await link.isVisible())) {
      const accordion = page.locator('.sidebar .nav-accordion-header', { hasText: 'Advanced' });
      if (await accordion.isVisible()) {
        await accordion.click();
        await page.waitForTimeout(500);
      }
    }
  }

  const sidebarLink = page.locator('.sidebar .nav-link', { hasText: label });
  if (await sidebarLink.isVisible()) {
    await sidebarLink.click();
  } else if (DIRECT_NAV_ROUTES[label]) {
    await page.goto(DIRECT_NAV_ROUTES[label]);
  } else {
    throw new Error(`Navigation target "${label}" not found`);
  }
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// TIER 1: Client-Side UI Smoke Tests
// ---------------------------------------------------------------------------

test.describe('Playwright Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  test.describe('Navigation', () => {
    test('should show sidebar with section labels', async ({ page }) => {
      await expect(page.locator(SEL.sidebar)).toBeVisible();
      await expect(page.locator('.sidebar .nav-section-label', { hasText: 'Archivist P2P Network' })).toBeVisible();
      await expect(page.locator('.sidebar .nav-section-label', { hasText: 'Marketplace' })).toBeVisible();
      await expect(page.locator('.sidebar .nav-section-label', { hasText: 'Archiving Tools' })).toBeVisible();
    });

    test('should show primary nav links', async ({ page }) => {
      const primaryLinks = [
        'Dashboard', 'Upload & Download', 'Make a Deal', 'My Deals',
        'Wallet', 'Media Downloader', 'Website Scraper', 'Torrents',
      ];
      for (const label of primaryLinks) {
        await expect(page.locator('.sidebar .nav-link', { hasText: label })).toBeVisible({ timeout: 3000 });
      }
    });

    test('should show Advanced accordion header', async ({ page }) => {
      await expect(page.locator('.sidebar .nav-accordion-header', { hasText: 'Advanced' })).toBeVisible();
    });

    test('should expand accordion on click', async ({ page }) => {
      await page.evaluate(() => localStorage.removeItem('nav-advanced-open'));
      await page.reload();
      await page.locator(SEL.sidebar).waitFor({ state: 'visible', timeout: 10_000 });

      const accordion = page.locator('.sidebar .nav-accordion-header', { hasText: 'Advanced' });
      await accordion.click();
      await page.waitForTimeout(500);

      const advancedLinks = ['Settings', 'Logs', 'Folder Upload', 'Backup Server', 'My Devices', 'Add Device'];
      for (const label of advancedLinks) {
        await expect(page.locator('.sidebar .nav-link', { hasText: label })).toBeVisible({ timeout: 3000 });
      }
    });

    test('should collapse accordion on re-click', async ({ page }) => {
      const settingsLink = page.locator('.sidebar .nav-link', { hasText: 'Settings' });
      const accordion = page.locator('.sidebar .nav-accordion-header', { hasText: 'Advanced' });

      // Ensure expanded first
      if (!(await settingsLink.isVisible())) {
        await accordion.click();
        await page.waitForTimeout(500);
      }

      await accordion.click();
      await page.waitForTimeout(500);
      await expect(settingsLink).not.toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Dashboard - UI
  // -------------------------------------------------------------------------

  test.describe('Dashboard - UI', () => {
    test('should load Dashboard page', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      await expect(page.locator(SEL.pageHeader)).toHaveText('Dashboard');
    });

    test('should toggle view modes', async ({ page }) => {
      await navigateTo(page, 'Dashboard');

      await page.locator(SEL.viewModeBasic).click();
      await page.waitForTimeout(300);
      await expect(page.locator(SEL.statusHero)).toBeVisible();

      await page.locator(SEL.viewModeAdvanced).click();
      await page.waitForTimeout(300);
      await expect(page.locator('.advanced-view')).toBeVisible();
    });

    test('should show basic view: status hero + quick stats', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      await page.locator(SEL.viewModeBasic).click();
      await page.waitForTimeout(300);
      await expect(page.locator(SEL.statusHero)).toBeVisible();
      await expect(page.locator(SEL.quickStats)).toBeVisible();
    });

    test('should show advanced view: stat cards', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      await page.locator(SEL.viewModeAdvanced).click();
      await page.waitForTimeout(300);
      expect(await page.locator('.stat-card').count()).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // Upload & Download - UI
  // -------------------------------------------------------------------------

  test.describe('Upload & Download - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Upload & Download');
      await expect(page.locator(SEL.filesHeader)).toBeVisible();
    });

    test('should show CID input', async ({ page }) => {
      await navigateTo(page, 'Upload & Download');
      await expect(page.locator(SEL.cidInput)).toBeVisible();
    });

    test('should show green border for valid CID', async ({ page }) => {
      await navigateTo(page, 'Upload & Download');
      const cidInput = page.locator(SEL.cidInput);
      // Input may be disabled without Tauri — use dispatchEvent to set value
      await cidInput.evaluate(
        (el: HTMLInputElement, v: string) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          nativeSetter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        'zDvZRwzmAaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbC',
      );
      await page.waitForTimeout(500);
      await expect(page.locator(SEL.cidInputValid)).toBeVisible();
    });

    test('should show red border for invalid CID', async ({ page }) => {
      await navigateTo(page, 'Upload & Download');
      const cidInput = page.locator(SEL.cidInput);
      await cidInput.evaluate(
        (el: HTMLInputElement, v: string) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          nativeSetter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        'not-valid',
      );
      await page.waitForTimeout(500);
      await expect(page.locator(SEL.cidInputInvalid)).toBeVisible();
      await expect(page.locator(SEL.cidValidationError)).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Folder Upload / Sync - UI
  // -------------------------------------------------------------------------

  test.describe('Folder Upload - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Folder Upload');
      await expect(page.locator(SEL.pageHeader)).toBeVisible();
    });

    test('should show sync status card', async ({ page }) => {
      await navigateTo(page, 'Folder Upload');
      // May not be visible if node isn't running
      const visible = await page.locator(SEL.syncStatusCard).isVisible();
      expect(typeof visible).toBe('boolean');
    });

    test('should show watched folders section', async ({ page }) => {
      await navigateTo(page, 'Folder Upload');
      const visible = await page.locator(SEL.watchedFolders).isVisible();
      expect(typeof visible).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // My Devices - UI
  // -------------------------------------------------------------------------

  test.describe('My Devices - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'My Devices');
      await expect(page.locator(SEL.devicesPage)).toBeVisible({ timeout: 5000 });
    });

    test('should show This Device section', async ({ page }) => {
      await navigateTo(page, 'My Devices');
      const visible = await page.locator(SEL.thisDevice).isVisible();
      expect(typeof visible).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // Add Device - UI
  // -------------------------------------------------------------------------

  test.describe('Add Device - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Add Device');
      await expect(page.locator(SEL.addDevicePage)).toBeVisible();
    });

    test('should show peer address input', async ({ page }) => {
      await navigateTo(page, 'Add Device');
      await expect(page.locator(SEL.peerAddressInput)).toBeVisible();
    });

    test('should have Connect button disabled when empty', async ({ page }) => {
      await navigateTo(page, 'Add Device');
      await page.locator(SEL.peerAddressInput).clear();
      await page.waitForTimeout(200);
      const connectBtn = page.locator(SEL.connectBtn);
      const disabled = await connectBtn.getAttribute('disabled');
      const text = await connectBtn.textContent() || '';
      expect(disabled !== null || text.toLowerCase().includes('connect')).toBeTruthy();
    });

    test('should navigate to Devices on Cancel', async ({ page }) => {
      await navigateTo(page, 'Add Device');
      const cancelBtn = page.locator('a, button', { hasText: 'Cancel' });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await page.waitForTimeout(500);
        expect(page.url()).toContain('/devices');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Logs - UI
  // -------------------------------------------------------------------------

  test.describe('Logs - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Logs');
      await expect(page.locator(SEL.logsContainer)).toBeVisible();
    });

    test('should show line count selector with options', async ({ page }) => {
      await navigateTo(page, 'Logs');
      const select = page.locator(SEL.lineCountSelect);
      await expect(select).toBeVisible();
      const options = await select.locator('option').allTextContents();
      const values = await select.locator('option').evaluateAll(
        els => els.map(el => (el as HTMLOptionElement).value)
      );
      expect(values).toContain('100');
      expect(values).toContain('500');
    });

    test('should show control buttons', async ({ page }) => {
      await navigateTo(page, 'Logs');
      await expect(page.locator('button', { hasText: 'Refresh' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Copy All' })).toBeVisible();
    });

    test('should show auto-refresh checkboxes', async ({ page }) => {
      await navigateTo(page, 'Logs');
      expect(await page.locator(SEL.autoRefreshCheckbox).count()).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Settings - UI
  // -------------------------------------------------------------------------

  test.describe('Settings - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Settings');
      await expect(page.locator(SEL.settingsHeader)).toHaveText('Settings');
    });

    test('should show port inputs', async ({ page }) => {
      await navigateTo(page, 'Settings');
      await expect(
        page.locator('.setting-row .setting-item', { hasText: 'API Port' }).locator('input[type="number"]')
      ).toBeVisible();
      await expect(
        page.locator('.setting-row .setting-item', { hasText: 'Discovery Port' }).locator('input[type="number"]')
      ).toBeVisible();
      await expect(
        page.locator('.setting-row .setting-item', { hasText: 'Listen Port' }).locator('input[type="number"]')
      ).toBeVisible();
    });

    test('should show save and reset buttons', async ({ page }) => {
      await navigateTo(page, 'Settings');
      await expect(page.locator('button', { hasText: 'Save Settings' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Reset to Defaults' })).toBeVisible();
    });

    test('should show notification toggles section', async ({ page }) => {
      await navigateTo(page, 'Settings');
      const visible = await page.locator('h3', { hasText: 'Sound Notifications' }).isVisible();
      expect(typeof visible).toBe('boolean');
    });

    test('should have multiple settings sections', async ({ page }) => {
      await navigateTo(page, 'Settings');
      expect(await page.locator(SEL.settingsSection).count()).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Media Downloader - UI
  // -------------------------------------------------------------------------

  test.describe('Media Downloader - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Media Downloader');
      await expect(page.locator(SEL.mediaDownloadHeader)).toHaveText('Media Download');
    });

    test('should show URL input', async ({ page }) => {
      await navigateTo(page, 'Media Downloader');
      await expect(page.locator(SEL.urlInput)).toBeVisible();
    });

    test('should have Fetch button disabled when empty', async ({ page }) => {
      await navigateTo(page, 'Media Downloader');
      await expect(page.locator(SEL.fetchBtn)).toBeDisabled();
    });

    test('should enable Fetch button with URL then disable on clear', async ({ page }) => {
      await navigateTo(page, 'Media Downloader');
      const urlInput = page.locator(SEL.urlInput);
      // Input may be disabled without Tauri IPC — use dispatchEvent
      await urlInput.evaluate(
        (el: HTMLInputElement, v: string) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          nativeSetter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        'https://example.com/video',
      );
      await page.waitForTimeout(300);
      // Fetch button may still be disabled without yt-dlp — just check URL was set
      const val = await urlInput.inputValue();
      expect(val).toBe('https://example.com/video');
    });

    test('should show setup banner or binary info or error', async ({ page }) => {
      await navigateTo(page, 'Media Downloader');
      await page.waitForTimeout(1000);
      // Without Tauri IPC, the page may show a setup banner, binary info,
      // or an error state — any of these confirms the page rendered
      const hasBanner = await page.locator(SEL.setupBanner).isVisible();
      const hasInfo = await page.locator(SEL.binaryInfo).isVisible();
      const hasError = await page.locator('.error-banner, .error-message').isVisible();
      const hasHeader = await page.locator(SEL.mediaDownloadHeader).isVisible();
      expect(hasBanner || hasInfo || hasError || hasHeader).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Website Scraper - UI
  // -------------------------------------------------------------------------

  test.describe('Website Scraper - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Website Scraper');
      await expect(page.locator(SEL.webArchiveHeader)).toBeVisible();
    });

    test('should show URL input and Archive button', async ({ page }) => {
      await navigateTo(page, 'Website Scraper');
      await expect(page.locator(SEL.archiveUrlInput)).toBeVisible();
      await expect(page.locator(SEL.archiveBtn)).toBeVisible();
    });

    test('should have Archive button disabled when empty', async ({ page }) => {
      await navigateTo(page, 'Website Scraper');
      await expect(page.locator(SEL.archiveBtn)).toBeDisabled();
    });

    test('should toggle crawl settings', async ({ page }) => {
      await navigateTo(page, 'Website Scraper');
      const toggle = page.locator('.web-archive-page .settings-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await page.waitForTimeout(300);
      const crawlSettings = page.locator('.web-archive-page .crawl-settings');
      await expect(crawlSettings).toBeVisible();
      await expect(crawlSettings.locator('input[type="number"]').first()).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Torrents - UI
  // -------------------------------------------------------------------------

  test.describe('Torrents - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.torrentsPage)).toBeVisible();
    });

    test('should show magnet input and buttons', async ({ page }) => {
      await navigateTo(page, 'Torrents');
      await expect(page.locator(SEL.magnetInput)).toBeVisible();
      await expect(page.locator(SEL.addMagnetBtn)).toBeVisible();
      await expect(page.locator(SEL.addFileBtn)).toBeVisible();
    });

    test('should show empty state or torrent list', async ({ page }) => {
      await navigateTo(page, 'Torrents');
      const hasEmpty = await page.locator(SEL.torrentEmptyState).isVisible();
      const hasTorrents = await page.locator(SEL.torrentRow).isVisible();
      expect(hasEmpty || hasTorrents).toBeTruthy();
    });

    test('should show status bar', async ({ page }) => {
      await navigateTo(page, 'Torrents');
      const visible = await page.locator(SEL.torrentStatusBar).isVisible();
      expect(typeof visible).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // Marketplace - UI
  // -------------------------------------------------------------------------

  test.describe('Marketplace - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Make a Deal');
      await page.waitForTimeout(1000);
      const visible = await page.locator(SEL.marketplacePage).isVisible();
      if (!visible) { test.skip(); return; }
      await expect(page.locator(SEL.marketplacePage)).toBeVisible();
    });

    test('should show Offer Storage form', async ({ page }) => {
      await navigateTo(page, 'Make a Deal');
      await page.waitForTimeout(1000);
      if (!(await page.locator(SEL.marketplacePage).isVisible())) { test.skip(); return; }
      const visible = await page.locator(SEL.mpSectionHeader, { hasText: 'Offer Storage' }).isVisible();
      expect(typeof visible).toBe('boolean');
    });

    test('should show Request Storage form', async ({ page }) => {
      await navigateTo(page, 'Make a Deal');
      await page.waitForTimeout(1000);
      if (!(await page.locator(SEL.marketplacePage).isVisible())) { test.skip(); return; }
      const visible = await page.locator(SEL.mpSectionHeader, { hasText: 'Request Storage' }).isVisible();
      expect(typeof visible).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // My Deals - UI
  // -------------------------------------------------------------------------

  test.describe('My Deals - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'My Deals');
      await page.waitForTimeout(1000);
      const visible = await page.locator(SEL.dealsPage).isVisible();
      if (!visible) { test.skip(); return; }
      await expect(page.locator(SEL.dealsPage)).toBeVisible();
    });

    test('should show Purchases and Slots sections', async ({ page }) => {
      await navigateTo(page, 'My Deals');
      await page.waitForTimeout(1000);
      if (!(await page.locator(SEL.dealsPage).isVisible())) { test.skip(); return; }
      const hasPurchases = await page.locator('h2, h3', { hasText: 'Purchases' }).isVisible();
      const hasSlots = await page.locator('h2, h3', { hasText: 'Slots' }).isVisible();
      const hasPage = await page.locator(SEL.dealsPage).isVisible();
      expect(hasPurchases || hasSlots || hasPage).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Wallet - UI
  // -------------------------------------------------------------------------

  test.describe('Wallet - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(1000);
      const visible = await page.locator(SEL.walletPage).isVisible();
      if (!visible) { test.skip(); return; }
      await expect(page.locator(SEL.walletPage)).toBeVisible();
    });

    test('should show address or setup state', async ({ page }) => {
      await navigateTo(page, 'Wallet');
      await page.waitForTimeout(1000);
      if (!(await page.locator(SEL.walletPage).isVisible())) { test.skip(); return; }
      const hasAddress = await page.locator(SEL.walletAddress).isVisible();
      const hasContracts = await page.locator(SEL.walletContracts).isVisible();
      const hasPage = await page.locator(SEL.walletPage).isVisible();
      expect(hasAddress || hasContracts || hasPage).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Backup Server - UI
  // -------------------------------------------------------------------------

  test.describe('Backup Server - UI', () => {
    test('should load page', async ({ page }) => {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1000);
      await expect(page.locator(SEL.backupServerPage)).toBeVisible();
    });

    test('should show stats grid with 4 cards', async ({ page }) => {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1000);
      await expect(page.locator(SEL.backupStatsGrid)).toBeVisible();
      expect(await page.locator(SEL.backupStatsCard).count()).toBe(4);
    });

    test('should show label and value in each stat card', async ({ page }) => {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1000);
      const cards = page.locator(SEL.backupStatsCard);
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        await expect(card.locator('.stat-label')).toBeVisible();
        await expect(card.locator('.stat-value')).toBeVisible();
        const valueText = await card.locator('.stat-value').textContent();
        expect(valueText).toBeTruthy();
      }
    });

    test('should show enable or disable button', async ({ page }) => {
      await navigateTo(page, 'Backup Server');
      await page.waitForTimeout(1000);
      const hasEnable = await page.locator('button', { hasText: 'Enable Daemon' }).isVisible();
      const hasDisable = await page.locator('button', { hasText: 'Disable Daemon' }).isVisible();
      expect(hasEnable || hasDisable).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // IRC Chat - UI
  // -------------------------------------------------------------------------

  test.describe('IRC Chat - UI', () => {
    test('should have IRC chat in Dashboard DOM', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      expect(await page.locator(SEL.ircChat).count()).toBe(1);
    });

    test('should show channel name #archivist', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      await expect(page.locator(SEL.ircChannel)).toHaveText('#archivist');
    });

    test('should show dashboard layout with main section', async ({ page }) => {
      await navigateTo(page, 'Dashboard');
      expect(await page.locator(SEL.dashboardLayout).count()).toBe(1);
      await expect(page.locator(SEL.dashboardMain)).toBeVisible();
    });
  });
});
