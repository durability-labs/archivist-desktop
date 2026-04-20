/**
 * End-to-end regression for node start/stop controls on the Dashboard.
 * Verifies button labels, that clicking Stop actually stops the sidecar
 * process (reflected in the sidecar API becoming unreachable), and that
 * clicking Start brings it back.
 */
import { test, expect } from '../fixtures/app';
import { navigateTo } from '../fixtures/appHelpers';

async function apiReachable(): Promise<boolean> {
  try {
    const resp = await fetch('http://127.0.0.1:8080/api/archivist/v1/debug/info', {
      signal: AbortSignal.timeout(2_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function waitForApi(expected: boolean, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await apiReachable()) === expected) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

test.describe('Dashboard — node lifecycle', () => {
  test('Dashboard shows "Start Node" or "Stop Node" + "Restart Node" labels (UX overhaul)', async ({
    page,
  }) => {
    await navigateTo(page, 'Dashboard');

    // At any given moment, one of these should be visible depending on state.
    const start = page.locator('button', { hasText: /^Start Node$/ });
    const stop = page.locator('button', { hasText: /^Stop Node$/ });
    const restart = page.locator('button', { hasText: /^Restart Node$/ });

    const startVisible = await start.isVisible().catch(() => false);
    const stopVisible = await stop.isVisible().catch(() => false);

    expect(
      startVisible || stopVisible,
      'Expected either "Start Node" or "Stop Node" button to be visible',
    ).toBe(true);

    if (stopVisible) {
      // When the node is running, Restart Node should be visible too.
      await expect(restart).toBeVisible();
    }
  });

  test('Stop Node → API unreachable → Start Node → API back', async ({ page, tailNodeLog }) => {
    test.setTimeout(120_000);
    await navigateTo(page, 'Dashboard');

    // Make sure we start from the "running" state. If the UI shows Start Node,
    // the sidecar is already stopped — skip this test.
    const stopBtn = page.locator('button', { hasText: /^Stop Node$/ });
    if (!(await stopBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Node is not running at test start — skipping stop/start cycle');
      return;
    }

    expect(await apiReachable(), 'API should be reachable while node is running').toBe(true);

    const tail = tailNodeLog();
    await stopBtn.click();

    // Wait for the API to become unreachable (sidecar process died).
    expect(await waitForApi(false), 'API should become unreachable after Stop').toBe(true);

    // UI should now show Start Node
    const startBtn = page.locator('button', { hasText: /^Start Node$/ });
    await expect(startBtn).toBeVisible({ timeout: 15_000 });

    await startBtn.click();

    // API should come back
    expect(await waitForApi(true, 45_000), 'API should become reachable after Start').toBe(true);

    // Sanity-check the log didn't emit "Unrecognized option" during the cycle
    // — that was a regression class we fixed previously.
    const chunk = tail.readNew();
    expect(chunk).not.toMatch(/Unrecognized option/);
  });
});
