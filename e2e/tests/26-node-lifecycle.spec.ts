import { navigateTo, sleep, waitForPort, apiDebugInfo } from '../helpers';

/**
 * @smoke
 * Node lifecycle tests — start, stop, restart, API health.
 */
describe('Node lifecycle @smoke', () => {
  it('should show node running on Dashboard', async () => {
    await navigateTo('Dashboard');
    await browser.pause(1000);

    // Look for "Running" status text
    const running = await $('*=Running');
    await running.waitForDisplayed({ timeout: 15000 });
  });

  it('should stop the node', async () => {
    await navigateTo('Dashboard');
    await browser.pause(500);

    // Stop the node via Tauri invoke
    await browser.execute(() =>
      (window as any).__TAURI__.invoke('stop_node'),
    );
    await sleep(2000);

    // Refresh the dashboard to pick up the new status
    await navigateTo('Dashboard');
    await browser.pause(1500);

    // Should show "Stopped" status
    const stopped = await $('*=Stopped');
    await stopped.waitForDisplayed({ timeout: 10000 });
  });

  it('should start the node', async () => {
    await navigateTo('Dashboard');
    await browser.pause(500);

    // Start the node via Tauri invoke
    await browser.execute(() =>
      (window as any).__TAURI__.invoke('start_node'),
    );
    await sleep(3000);

    // Refresh the dashboard
    await navigateTo('Dashboard');
    await browser.pause(1500);

    // Should show "Running" status
    const running = await $('*=Running');
    await running.waitForDisplayed({ timeout: 15000 });
  });

  it('should restart the node', async () => {
    await navigateTo('Dashboard');
    await browser.pause(500);

    // Restart via Tauri invoke
    await browser.execute(() =>
      (window as any).__TAURI__.invoke('restart_node'),
    );
    await sleep(5000);

    // Refresh the dashboard
    await navigateTo('Dashboard');
    await browser.pause(1500);

    // Should show "Running" status after restart
    const running = await $('*=Running');
    await running.waitForDisplayed({ timeout: 15000 });
  });

  it('should have healthy sidecar API after restart', async () => {
    // Wait for sidecar API to be reachable
    await waitForPort(8080, 15000);

    // Verify the API actually responds with valid data
    const info = await apiDebugInfo();
    expect(info.id).toBeTruthy();
    expect(info.id.length).toBeGreaterThan(10);
    expect(info.addrs).toBeDefined();
  });
});
