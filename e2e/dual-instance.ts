/**
 * Dual-instance test utilities for WebdriverIO + tauri-driver.
 *
 * Manages a second Archivist Desktop instance with non-conflicting ports:
 *   Primary:   API 8080, P2P 8070, Discovery 8090 (managed by wdio.conf.ts)
 *   Secondary: API 9080, P2P 9070, Discovery 9090 (managed here via remote())
 */

import { remote, type Browser as RemoteBrowser } from 'webdriverio';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { waitForPort, apiDebugInfo, apiSpr, sleep, hasText } from './helpers';

// ---------------------------------------------------------------------------
// Port configuration
// ---------------------------------------------------------------------------

export const PRIMARY = {
  api: 8080,
  p2p: 8070,
  discovery: 8090,
} as const;

export const SECONDARY = {
  api: 9080,
  p2p: 9070,
  discovery: 9090,
  tauriDriverPort: 4445,
} as const;

// ---------------------------------------------------------------------------
// Second instance management
// ---------------------------------------------------------------------------

let secondTauriDriver: ChildProcess | null = null;

/**
 * Locate the debug binary.
 */
function findDebugBinary(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', 'archivist-desktop'),
    path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'Archivist Desktop.app', 'Contents', 'MacOS', 'archivist-desktop'),
    path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', 'archivist-desktop.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Debug binary not found. Run "pnpm tauri build --debug" first.');
}

/**
 * Start a second tauri-driver instance and create a WebdriverIO remote session.
 * The second instance uses different ports for the sidecar.
 */
export async function connectToSecondApp(): Promise<RemoteBrowser> {
  // Start second tauri-driver if not already running
  if (!secondTauriDriver) {
    secondTauriDriver = spawn('tauri-driver', ['--port', String(SECONDARY.tauriDriverPort)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for it to be ready
    const net = await import('net');
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.connect(SECONDARY.tauriDriverPort, '127.0.0.1');
      });
      if (ok) break;
      await sleep(300);
    }
  }

  // Create remote session with different ports
  const secondBrowser = await remote({
    hostname: '127.0.0.1',
    port: SECONDARY.tauriDriverPort,
    capabilities: {
      browserName: 'wry',
      'tauri:options': {
        application: findDebugBinary(),
        args: [
          `--api-port=${SECONDARY.api}`,
          `--disc-port=${SECONDARY.discovery}`,
          `--listen-port=${SECONDARY.p2p}`,
        ],
      },
    } as any,
  });

  // Skip onboarding on second instance
  await secondBrowser.execute(() => {
    localStorage.setItem('archivist_onboarding_complete', 'true');
  });
  await secondBrowser.url('/');
  const sidebar = await secondBrowser.$('.sidebar');
  await sidebar.waitForDisplayed({ timeout: 15000 });

  return secondBrowser;
}

/**
 * Close the second instance and clean up.
 */
export async function closeSecondApp(secondBrowser: RemoteBrowser): Promise<void> {
  try {
    await secondBrowser.deleteSession();
  } catch {
    // Session may already be closed
  }

  if (secondTauriDriver) {
    secondTauriDriver.kill();
    secondTauriDriver = null;
  }
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
  secondBrowser: RemoteBrowser,
  apiPort1 = PRIMARY.api,
): Promise<string> {
  const info1 = await apiDebugInfo(apiPort1);
  const spr1 = await apiSpr(apiPort1);

  // On Instance 2, navigate to Add Device and paste the SPR
  // Expand Advanced accordion first
  const accordion = await secondBrowser.$('//*[contains(@class, "nav-accordion-header")][contains(., "Advanced")]');
  const addDeviceLink = await secondBrowser.$('//*[contains(@class, "nav-link")][contains(., "Add Device")]');
  const linkVisible = await addDeviceLink.isDisplayed().catch(() => false);
  if (!linkVisible) {
    await accordion.click();
    await secondBrowser.pause(500);
  }
  await addDeviceLink.click();
  await secondBrowser.pause(500);

  const input = await secondBrowser.$('#peer-address');
  await input.setValue(spr1);

  const connectBtn = await secondBrowser.$('.primary');
  await connectBtn.click();

  // Wait for connection to establish
  await sleep(5_000);

  return info1.id;
}

/**
 * Disconnect peers by stopping and restarting the secondary node.
 */
export async function disconnectPeers(secondBrowser: RemoteBrowser): Promise<void> {
  await secondBrowser.execute(() =>
    (window as any).__TAURI__.invoke('stop_node'),
  ).catch(() => {});
  await sleep(1_000);

  await secondBrowser.execute(() =>
    (window as any).__TAURI__.invoke('start_node'),
  ).catch(() => {});
  await sleep(3_000);
}
