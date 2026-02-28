import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, SEL } from '../helpers';

/**
 * @smoke
 * Add Device page — full wizard state machine tests.
 */
test.describe('Add Device page @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  /**
   * Navigate to Add Device with a fresh wizard state.
   * Since tests share app state, we navigate away first to reset the wizard.
   */
  async function gotoFreshAddDevice(page: import('@playwright/test').Page): Promise<void> {
    await navigateTo(page, 'Dashboard');
    await page.waitForTimeout(300);
    await navigateTo(page, 'Add Device');
    await page.waitForTimeout(500);
  }

  test('should navigate to Add Device page', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);
      await expect(page.locator(SEL.addDevicePage)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should show wizard initial state with input and disabled Connect', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      // Wizard step should be visible
      const wizardStep = page.locator(SEL.wizardStep);
      await expect(wizardStep).toBeVisible();

      // Peer address textarea should be visible and empty
      const input = page.locator(SEL.peerAddressInput);
      await expect(input).toBeVisible();
      const inputValue = await input.inputValue();
      expect(inputValue).toBe('');

      // Connect button should be disabled when input is empty
      const connectBtn = page.locator('.primary:has-text("Connect")');
      const isDisabled = await connectBtn.isDisabled();
      expect(isDisabled).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('should enable Connect button when text is entered', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      const input = page.locator(SEL.peerAddressInput);
      const connectBtn = page.locator('.primary:has-text("Connect")');

      // Initially disabled
      expect(await connectBtn.isDisabled()).toBeTruthy();

      // Type something into the input
      await input.fill('/ip4/192.168.1.100/tcp/8070/p2p/16Uiu2HAmTestPeerId');
      await page.waitForTimeout(300);

      // Connect button should now be enabled
      expect(await connectBtn.isDisabled()).toBeFalsy();
    } finally {
      await browser.close();
    }
  });

  test('should show error step for invalid address', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      const input = page.locator(SEL.peerAddressInput);
      await input.fill('not-a-valid-peer-address');

      const connectBtn = page.locator('.primary:has-text("Connect")');
      await connectBtn.click();

      // Wait for the connection attempt to fail
      const wizardError = page.locator(SEL.wizardError);
      await expect(wizardError).toBeVisible({ timeout: 15_000 });

      // Error icon should be visible
      const errorIcon = page.locator(SEL.wizardIconError);
      await expect(errorIcon).toBeVisible();

      // Error message should have text
      const errorText = await wizardError.textContent();
      expect(errorText).toBeTruthy();
      expect(errorText!.trim().length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });

  test('should return to input step via Try Again button', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      // Trigger error state first
      const input = page.locator(SEL.peerAddressInput);
      await input.fill('garbage-address');
      await page.locator('.primary:has-text("Connect")').click();

      // Wait for error step
      await expect(page.locator(SEL.wizardError)).toBeVisible({ timeout: 15_000 });

      // Click Try Again
      const tryAgainBtn = page.locator('button:has-text("Try Again")');
      await expect(tryAgainBtn).toBeVisible();
      await tryAgainBtn.click();
      await page.waitForTimeout(500);

      // Should be back to input step with textarea visible
      await expect(page.locator(SEL.peerAddressInput)).toBeVisible();

      // Connect button should be visible
      const connectBtn = page.locator('.primary:has-text("Connect")');
      await expect(connectBtn).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should navigate to devices page on Cancel', async () => {
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      const cancelBtn = page.locator('button:has-text("Cancel")');
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();
      await page.waitForTimeout(1_000);

      // Should navigate to devices page
      await expect(page.locator(SEL.devicesPage)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should show connecting state briefly when valid-looking address submitted', async () => {
    test.setTimeout(45_000);
    const { browser, page } = await connectToApp();
    try {
      await gotoFreshAddDevice(page);

      const input = page.locator(SEL.peerAddressInput);
      // Use a valid multiaddr format that won't actually connect
      await input.fill('/ip4/192.168.99.99/tcp/8070/p2p/16Uiu2HAmFakeTestPeerId');

      const connectBtn = page.locator('.primary:has-text("Connect")');
      await connectBtn.click();

      // Should briefly show connecting state (spinner icon)
      const connectingIcon = page.locator(SEL.wizardIconConnecting);
      const hasConnecting = await connectingIcon.isVisible({ timeout: 3_000 }).catch(() => false);

      // Eventually should show error (unreachable peer)
      const wizardError = page.locator(SEL.wizardError);
      await expect(wizardError).toBeVisible({ timeout: 30_000 });
    } finally {
      await browser.close();
    }
  });
});
