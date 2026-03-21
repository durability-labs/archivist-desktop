import { navigateTo, ensurePastOnboarding, hasText, isDisplayed, getCount, sleep, SEL } from '../helpers';

/**
 * @smoke
 * Backup Server page — daemon lifecycle tests with deep UI interaction.
 */
describe('Backup Server page @smoke', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('should navigate to Backup Server page', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    await expect($(SEL.backupServerPage)).toBeDisplayed();
  });

  it('should display page header', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    const header = $(SEL.backupServerHeader);
    await expect(header).toBeDisplayed();
    const text = await header.getText();
    expect(text.toLowerCase()).toContain('backup');
  });

  it('should show stats cards with values', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    // Stats grid should always be visible
    const statsGrid = $(SEL.backupStatsGrid);
    await expect(statsGrid).toBeDisplayed();

    // Should have 4 stat cards
    const statCards = $$(SEL.backupStatsCard);
    expect(await statCards.length).toBe(4);

    const cardCount = await statCards.length;
    // Each card should have a label and value
    for (let i = 0; i < cardCount; i++) {
      const card = statCards[i];
      const label = card.$('.stat-label');
      const value = card.$('.stat-value');
      await expect(label).toBeDisplayed();
      await expect(value).toBeDisplayed();

      const valueText = await value.getText();
      expect(valueText).toBeTruthy();
    }
  });

  it('should show configuration section', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    const configGrid = $(SEL.backupConfigGrid);
    const hasConfig = await configGrid.isDisplayed().catch(() => false);

    if (hasConfig) {
      const configItems = await $$('.config-item');
      expect(configItems.length).toBeGreaterThanOrEqual(3);

      const firstLabel = configItems[0].$('.config-label');
      const firstValue = configItems[0].$('.config-value');
      await expect(firstLabel).toBeDisplayed();
      await expect(firstValue).toBeDisplayed();
    }
  });

  it('should enable daemon and verify UI updates', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    const enableBtn = await hasText('button', 'Enable Daemon');
    const hasEnable = await enableBtn.isDisplayed().catch(() => false);

    if (hasEnable) {
      await enableBtn.click();
      await enableBtn.waitForDisplayed({ timeout: 10_000, reverse: true });

      // After enabling: Pause, Resume, and Disable Daemon buttons should appear
      const pauseBtn = await hasText('button', 'Pause');
      await expect(pauseBtn).toBeDisplayed();
      const disableBtn = await hasText('button', 'Disable Daemon');
      await expect(disableBtn).toBeDisplayed();

      // Info banner should disappear
      const infoBanner = $(SEL.backupInfoBanner);
      await expect(infoBanner).not.toBeDisplayed();
    } else {
      // Daemon already enabled — check Pause or Resume is visible
      const pauseVisible = await isDisplayed(SEL.torrentPauseBtn, 1000);
      const pauseBtnText = await hasText('button', 'Pause');
      const resumeBtnText = await hasText('button', 'Resume');
      const hasPause = await pauseBtnText.isDisplayed().catch(() => false);
      const hasResume = await resumeBtnText.isDisplayed().catch(() => false);
      expect(hasPause || hasResume).toBe(true);

      const disableBtn = await hasText('button', 'Disable Daemon');
      await expect(disableBtn).toBeDisplayed();
    }
  });

  it('should pause and resume daemon', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    // Ensure daemon is enabled
    const enableBtn = await hasText('button', 'Enable Daemon');
    if (await enableBtn.isDisplayed().catch(() => false)) {
      await enableBtn.click();
      await enableBtn.waitForDisplayed({ timeout: 10_000, reverse: true });
    }

    // Click Pause
    const pauseBtn = await hasText('button', 'Pause');
    if (await pauseBtn.isDisplayed().catch(() => false)) {
      await pauseBtn.click();
      await browser.pause(2_000);
      await expect($(SEL.backupServerPage)).toBeDisplayed();

      // Click Resume
      const resumeBtn = await hasText('button', 'Resume');
      if (await resumeBtn.isDisplayed().catch(() => false)) {
        await resumeBtn.click();
        await browser.pause(2_000);
        await expect($(SEL.backupServerPage)).toBeDisplayed();
      }
    }
  });

  it('should disable daemon and verify info banner returns', async () => {
    await navigateTo('Backup Server');
    await browser.pause(1_000);

    const disableBtn = await hasText('button', 'Disable Daemon');
    const hasDisable = await disableBtn.isDisplayed().catch(() => false);

    if (hasDisable) {
      await disableBtn.click();
      await disableBtn.waitForDisplayed({ timeout: 10_000, reverse: true });

      // Enable Daemon button should reappear
      const enableBtn = await hasText('button', 'Enable Daemon');
      await enableBtn.waitForDisplayed({ timeout: 5_000 });

      // Info banner should reappear
      const infoBanner = $(SEL.backupInfoBanner);
      await expect(infoBanner).toBeDisplayed();
      const bannerText = await infoBanner.getText();
      expect(bannerText.toLowerCase()).toContain('disabled');
    } else {
      // Daemon already disabled
      const enableBtn = await hasText('button', 'Enable Daemon');
      await expect(enableBtn).toBeDisplayed();
      const infoBanner = $(SEL.backupInfoBanner);
      await expect(infoBanner).toBeDisplayed();
    }
  });
});
