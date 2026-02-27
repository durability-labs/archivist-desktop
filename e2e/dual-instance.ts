/**
 * Dual-instance test utilities.
 *
 * Manages a second Archivist Desktop instance with non-conflicting ports:
 *   Primary:   API 8080, P2P 8070, Discovery 8090, CDP 9222
 *   Secondary: API 9080, P2P 9070, Discovery 9090, CDP 9223
 */

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { waitForPort, apiDebugInfo, apiSpr, sleep } from './helpers';

// ---------------------------------------------------------------------------
// Port configuration
// ---------------------------------------------------------------------------

export const PRIMARY = {
  api: 8080,
  p2p: 8070,
  discovery: 8090,
  cdp: 9222,
} as const;

export const SECONDARY = {
  api: 9080,
  p2p: 9070,
  discovery: 9090,
  cdp: 9223,
} as const;

// ---------------------------------------------------------------------------
// CDP connection for the second instance
// ---------------------------------------------------------------------------

/**
 * Connect to the second app instance over CDP.
 * The caller is responsible for browser.close() when done.
 */
export async function connectToSecondApp(cdpPort = SECONDARY.cdp): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`No browser context on CDP port ${cdpPort} — is the second instance running?`);
  const page = context.pages()[0];
  if (!page) throw new Error(`No page found on CDP port ${cdpPort} — is the window visible?`);
  return { browser, context, page };
}

// ---------------------------------------------------------------------------
// Wait for both nodes
// ---------------------------------------------------------------------------

/**
 * Wait until both sidecar APIs are reachable.
 */
export async function waitForBothNodes(
  port1 = PRIMARY.api,
  port2 = SECONDARY.api,
  timeoutMs = 30_000,
): Promise<void> {
  await Promise.all([
    waitForPort(port1, timeoutMs),
    waitForPort(port2, timeoutMs),
  ]);
}

// ---------------------------------------------------------------------------
// Peer connection helpers
// ---------------------------------------------------------------------------

/**
 * Connect Instance 2 to Instance 1 by fetching Instance 1's SPR and
 * entering it on Instance 2's Add Device page.
 *
 * Returns the peer ID of Instance 1.
 */
export async function connectPeers(
  page1: Page,
  page2: Page,
  apiPort1 = PRIMARY.api,
): Promise<string> {
  // Get Instance 1's SPR and peer ID
  const info1 = await apiDebugInfo(apiPort1);
  const spr1 = await apiSpr(apiPort1);

  // On Instance 2, navigate to Add Device and paste the SPR
  await page2.locator('.sidebar .nav-link:has-text("Add Device")').click();
  await page2.waitForLoadState('networkidle');

  const input = page2.locator('#peer-address');
  await input.fill(spr1);

  const connectBtn = page2.locator('.primary');
  await connectBtn.click();

  // Wait for connection to establish
  await sleep(5_000);

  return info1.id;
}

/**
 * Disconnect peers by stopping and restarting the secondary node.
 * This is a clean way to tear down P2P connections.
 */
export async function disconnectPeers(page2: Page): Promise<void> {
  await page2.evaluate(() =>
    (window as any).__TAURI__.invoke('stop_node'),
  ).catch(() => {/* may already be stopped */});
  await sleep(1_000);

  await page2.evaluate(() =>
    (window as any).__TAURI__.invoke('start_node'),
  ).catch(() => {/* ignore */});
  await sleep(3_000);
}
