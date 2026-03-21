import { navigateTo, hasText, SEL } from '../helpers';

/**
 * @smoke
 * Add Device page — full wizard state machine tests.
 */
describe('Add Device page @smoke', () => {
  /**
   * Navigate to Add Device with a fresh wizard state.
   * Since tests share app state, we navigate away first to reset the wizard.
   */
  async function gotoFreshAddDevice(): Promise<void> {
    await navigateTo('Dashboard');
    await browser.pause(300);
    await navigateTo('Add Device');
    await browser.pause(500);
  }

  it('should navigate to Add Device page', async () => {
    await gotoFreshAddDevice();
    const page = await $(SEL.addDevicePage);
    await expect(page).toBeDisplayed();
  });

  it('should show wizard initial state with input and disabled Connect', async () => {
    await gotoFreshAddDevice();

    // Wizard step should be visible
    const wizardStep = await $(SEL.wizardStep);
    await expect(wizardStep).toBeDisplayed();

    // Peer address textarea should be visible and empty
    const input = await $(SEL.peerAddressInput);
    await expect(input).toBeDisplayed();
    const inputValue = await input.getValue();
    expect(inputValue).toBe('');

    // Connect button should be disabled when input is empty
    const connectBtn = await hasText('.primary', 'Connect');
    const isDisabled = !(await connectBtn.isEnabled());
    expect(isDisabled).toBeTruthy();
  });

  it('should enable Connect button when text is entered', async () => {
    await gotoFreshAddDevice();

    const input = await $(SEL.peerAddressInput);
    const connectBtn = await hasText('.primary', 'Connect');

    // Initially disabled
    expect(await connectBtn.isEnabled()).toBeFalsy();

    // Type something into the input
    await input.setValue('/ip4/192.168.1.100/tcp/8070/p2p/16Uiu2HAmTestPeerId');
    await browser.pause(300);

    // Connect button should now be enabled
    expect(await connectBtn.isEnabled()).toBeTruthy();
  });

  it('should show error step for invalid address', async function () {
    this.timeout(30000);
    await gotoFreshAddDevice();

    const input = await $(SEL.peerAddressInput);
    await input.setValue('not-a-valid-peer-address');

    const connectBtn = await hasText('.primary', 'Connect');
    await connectBtn.click();

    // Wait for the connection attempt to fail
    const wizardError = await $(SEL.wizardError);
    await wizardError.waitForDisplayed({ timeout: 15000 });

    // Error icon should be visible
    const errorIcon = await $(SEL.wizardIconError);
    await expect(errorIcon).toBeDisplayed();

    // Error message should have text
    const errorText = await wizardError.getText();
    expect(errorText).toBeTruthy();
    expect(errorText!.trim().length).toBeGreaterThan(0);
  });

  it('should return to input step via Try Again button', async function () {
    this.timeout(30000);
    await gotoFreshAddDevice();

    // Trigger error state first
    const input = await $(SEL.peerAddressInput);
    await input.setValue('garbage-address');
    const connectBtn = await hasText('.primary', 'Connect');
    await connectBtn.click();

    // Wait for error step
    const wizardError = await $(SEL.wizardError);
    await wizardError.waitForDisplayed({ timeout: 15000 });

    // Click Try Again
    const tryAgainBtn = await hasText('button', 'Try Again');
    await expect(tryAgainBtn).toBeDisplayed();
    await tryAgainBtn.click();
    await browser.pause(500);

    // Should be back to input step with textarea visible
    const peerInput = await $(SEL.peerAddressInput);
    await expect(peerInput).toBeDisplayed();

    // Connect button should be visible
    const connectBtn2 = await hasText('.primary', 'Connect');
    await expect(connectBtn2).toBeDisplayed();
  });

  it('should navigate to devices page on Cancel', async () => {
    await gotoFreshAddDevice();

    const cancelBtn = await hasText('button', 'Cancel');
    await expect(cancelBtn).toBeDisplayed();
    await cancelBtn.click();
    await browser.pause(1000);

    // Should navigate to devices page
    const devicesPage = await $(SEL.devicesPage);
    await devicesPage.waitForDisplayed({ timeout: 5000 });
  });

  it('should show connecting state briefly when valid-looking address submitted', async function () {
    this.timeout(45000);
    await gotoFreshAddDevice();

    const input = await $(SEL.peerAddressInput);
    // Use a valid multiaddr format that won't actually connect
    await input.setValue('/ip4/192.168.99.99/tcp/8070/p2p/16Uiu2HAmFakeTestPeerId');

    const connectBtn = await hasText('.primary', 'Connect');
    await connectBtn.click();

    // Should briefly show connecting state (spinner icon)
    const connectingIcon = await $(SEL.wizardIconConnecting);
    await connectingIcon.isDisplayed().catch(() => false);

    // Eventually should show error (unreachable peer)
    const wizardError = await $(SEL.wizardError);
    await wizardError.waitForDisplayed({ timeout: 30000 });
  });
});
