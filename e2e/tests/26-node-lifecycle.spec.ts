import { test, expect } from '@playwright/test';
import { connectToApp, waitForPort, navigateTo, sleep, apiDebugInfo } from '../helpers';

/**
 * @smoke
 * Node lifecycle tests — start, stop, restart, API health.
 */
test.describe.serial('Node lifecycle @smoke', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should show node running on Dashboard', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(1_000);

      // Look for "Running" status text
      const running = page.locator('text=Running').first();
      await expect(running).toBeVisible({ timeout: 15_000 });
    } finally {
      await browser.close();
    }
  });

  test('should stop the node', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(500);

      // Stop the node via Tauri invoke
      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('stop_node'),
      );
      await sleep(2_000);

      // Refresh the dashboard to pick up the new status
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(1_500);

      // Should show "Stopped" status
      const stopped = page.locator('text=Stopped').first();
      await expect(stopped).toBeVisible({ timeout: 10_000 });
    } finally {
      await browser.close();
    }
  });

  test('should start the node', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(500);

      // Start the node via Tauri invoke
      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('start_node'),
      );
      await sleep(3_000);

      // Refresh the dashboard
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(1_500);

      // Should show "Running" status
      const running = page.locator('text=Running').first();
      await expect(running).toBeVisible({ timeout: 15_000 });
    } finally {
      await browser.close();
    }
  });

  test('should restart the node', async () => {
    const { browser, page } = await connectToApp();
    try {
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(500);

      // Restart via Tauri invoke
      await page.evaluate(() =>
        (window as any).__TAURI__.invoke('restart_node'),
      );
      await sleep(5_000);

      // Refresh the dashboard
      await navigateTo(page, 'Dashboard');
      await page.waitForTimeout(1_500);

      // Should show "Running" status after restart
      const running = page.locator('text=Running').first();
      await expect(running).toBeVisible({ timeout: 15_000 });
    } finally {
      await browser.close();
    }
  });

  test('should have healthy sidecar API after restart', async () => {
    // Wait for sidecar API to be reachable
    await waitForPort(8080, 15_000);

    // Verify the API actually responds with valid data
    const info = await apiDebugInfo();
    expect(info.id).toBeTruthy();
    expect(info.id.length).toBeGreaterThan(10);
    expect(info.addrs).toBeDefined();
  });
});
